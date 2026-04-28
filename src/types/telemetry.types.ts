/**
 * telemetry.types.ts
 *
 * Shared telemetry event schemas for INVENTORY dashboard and SCAN mobile app.
 *
 * Architecture
 * ────────────
 * All telemetry events share a common base (`TelemetryEventBase`) and are
 * organized into four categories:
 *
 *   navigation   — route / view changes and deep-link activations
 *   user_action  — intentional user interactions (taps, scans, submissions)
 *   error        — recoverable and unrecoverable failure conditions
 *   performance  — timing measurements and latency observations
 *
 * Each category is a discriminated union keyed on `eventName`.
 * The top-level `TelemetryEvent` union is discriminated on `eventCategory`.
 *
 * Naming convention
 * ─────────────────
 *   INVENTORY events:  "inv:{category}:{action}"
 *   SCAN events:       "scan:{category}:{action}"
 *   Shared events:     "{category}:{action}"
 *
 * Usage
 * ─────
 *   import type { TelemetryEvent } from "@/types/telemetry.types";
 *
 *   function track(event: TelemetryEvent): void { ... }
 *
 *   track({
 *     eventCategory: "navigation",
 *     eventName: TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED,
 *     app: "inventory",
 *     sessionId: "...",
 *     userId: "...",
 *     timestamp: Date.now(),
 *     mapView: "M3",
 *     previousMapView: "M1",
 *   });
 */

// ─── App discriminator ────────────────────────────────────────────────────────

/** Identifies which app surface fired the event. */
export type TelemetryApp = "inventory" | "scan";

// ─── Event name constants ─────────────────────────────────────────────────────

/**
 * All telemetry event name string literals, grouped by app and category.
 *
 * Use these constants instead of raw string literals to prevent typos and
 * enable IDE autocomplete.
 */
export const TelemetryEventName = {
  // ── INVENTORY — Navigation ────────────────────────────────────────────────
  /** User switched the active map mode (M1→M5). */
  INV_NAV_MAP_VIEW_CHANGED: "inv:nav:map_view_changed",
  /** User selected a case pin on the map or from a list. */
  INV_NAV_CASE_SELECTED: "inv:nav:case_selected",
  /** User dismissed / closed the case detail panel. */
  INV_NAV_CASE_DESELECTED: "inv:nav:case_deselected",
  /** User switched the active detail panel tab (T1→T5). */
  INV_NAV_DETAIL_TAB_CHANGED: "inv:nav:detail_tab_changed",
  /** INVENTORY dashboard initial page load completed. */
  INV_NAV_PAGE_LOADED: "inv:nav:page_loaded",

  // ── INVENTORY — User Actions ──────────────────────────────────────────────
  /** User toggled a map layer on or off. */
  INV_ACTION_LAYER_TOGGLED: "inv:action:layer_toggled",
  /** User changed the organisation filter. */
  INV_ACTION_FILTER_ORG_CHANGED: "inv:action:filter_org_changed",
  /** User changed the kit / case template filter. */
  INV_ACTION_FILTER_KIT_CHANGED: "inv:action:filter_kit_changed",
  /** User dragged the M5 mission-replay scrubber. */
  INV_ACTION_MISSION_REPLAY_SCRUBBED: "inv:action:mission_replay_scrubbed",
  /** User initiated an export (label, PDF, CSV). */
  INV_ACTION_EXPORT_INITIATED: "inv:action:export_initiated",
  /** User clicked "Create Case" or opened the case creation modal. */
  INV_ACTION_CASE_CREATE_OPENED: "inv:action:case_create_opened",
  /** User applied a case template from the admin UI. */
  INV_ACTION_TEMPLATE_APPLIED: "inv:action:template_applied",

  // ── SCAN — Navigation ─────────────────────────────────────────────────────
  /** User navigated between SCAN app pages/routes. */
  SCAN_NAV_PAGE_CHANGED: "scan:nav:page_changed",
  /** Case detail was opened after a successful QR scan. */
  SCAN_NAV_CASE_OPENED: "scan:nav:case_opened",
  /** User entered the inspection checklist flow. */
  SCAN_NAV_INSPECTION_STARTED: "scan:nav:inspection_started",
  /** User opened the damage report / photo annotation flow. */
  SCAN_NAV_DAMAGE_REPORT_OPENED: "scan:nav:damage_report_opened",
  /** User opened the shipping (FedEx entry) flow. */
  SCAN_NAV_SHIP_FLOW_OPENED: "scan:nav:ship_flow_opened",
  /** User opened the custody handoff flow. */
  SCAN_NAV_CUSTODY_FLOW_OPENED: "scan:nav:custody_flow_opened",
  /** SCAN app initial page load completed. */
  SCAN_NAV_PAGE_LOADED: "scan:nav:page_loaded",

  // ── SCAN — User Actions ───────────────────────────────────────────────────
  /** QR code scan completed (success or failure recorded separately). */
  SCAN_ACTION_QR_SCANNED: "scan:action:qr_scanned",
  /** User changed the check state of a manifest item. */
  SCAN_ACTION_ITEM_CHECKED: "scan:action:item_checked",
  /** Damage photo submitted (photo + annotations uploaded). */
  SCAN_ACTION_DAMAGE_REPORTED: "scan:action:damage_reported",
  /** User typed or pasted a FedEx tracking number. */
  SCAN_ACTION_TRACKING_ENTERED: "scan:action:tracking_entered",
  /** Shipment form submitted successfully. */
  SCAN_ACTION_SHIPMENT_SUBMITTED: "scan:action:shipment_submitted",
  /** Custody handoff was initiated by the current holder. */
  SCAN_ACTION_CUSTODY_INITIATED: "scan:action:custody_initiated",
  /** Custody handoff was confirmed/completed by both parties. */
  SCAN_ACTION_CUSTODY_COMPLETED: "scan:action:custody_completed",
  /** User marked an inspection as complete. */
  SCAN_ACTION_INSPECTION_COMPLETED: "scan:action:inspection_completed",
  /** User added a free-text note to a case or manifest item. */
  SCAN_ACTION_NOTE_ADDED: "scan:action:note_added",
  /**
   * User placed an annotation pin on a damage photo in the SCAN markup tool.
   * Emitted for each individual pin placement (spec §23).
   */
  SCAN_ACTION_ANNOTATION_ADDED: "scan:action:annotation_added",
  /**
   * User removed an annotation pin from a damage photo in the SCAN markup tool.
   * Emitted for each individual pin removal (spec §23).
   */
  SCAN_ACTION_ANNOTATION_REMOVED: "scan:action:annotation_removed",

  // ── Errors (shared) ───────────────────────────────────────────────────────
  /** QR code scanner produced no decodable result. */
  ERROR_QR_SCAN_FAILED: "error:qr_scan_failed",
  /** Browser denied camera permission for QR scanning or photo capture. */
  ERROR_CAMERA_DENIED: "error:camera_denied",
  /** Photo upload to Convex file storage failed. */
  ERROR_PHOTO_UPLOAD_FAILED: "error:photo_upload_failed",
  /** A Convex query or mutation returned an error or timed out. */
  ERROR_CONVEX_QUERY_FAILED: "error:convex_query_failed",
  /** FedEx tracking number did not pass validation. */
  ERROR_FEDEX_VALIDATION_FAILED: "error:fedex_validation_failed",
  /** Generic network request failure (non-Convex). */
  ERROR_NETWORK_REQUEST_FAILED: "error:network_request_failed",
  /** Feature flag values could not be loaded from Convex. */
  ERROR_FEATURE_FLAG_LOAD_FAILED: "error:feature_flag_load_failed",
  /** An unexpected JavaScript exception was caught by an error boundary. */
  ERROR_UNHANDLED_EXCEPTION: "error:unhandled_exception",

  // ── Performance (shared) ──────────────────────────────────────────────────
  /** Time from map component mount to first tiles rendered. */
  PERF_MAP_RENDER: "perf:map_render",
  /** Round-trip duration for a Convex query response. */
  PERF_QUERY_RESPONSE: "perf:query_response",
  /** Full navigation timing measurement (e.g. LCP, TTFB). */
  PERF_NAVIGATION_TIMING: "perf:navigation_timing",
  /**
   * End-to-end latency from a SCAN app mutation submission to the
   * corresponding INVENTORY dashboard subscription update being received.
   * Target: ≤ 2 000 ms (real_time_fidelity requirement).
   */
  PERF_REALTIME_LATENCY: "perf:realtime_latency",
  /** Duration of a photo upload to Convex file storage. */
  PERF_PHOTO_UPLOAD: "perf:photo_upload",
  /** Map endpoint response time — target: < 200 ms p50. */
  PERF_MAP_ENDPOINT: "perf:map_endpoint",
} as const;

/** Union of all valid telemetry event name strings. */
export type TelemetryEventNameValue =
  (typeof TelemetryEventName)[keyof typeof TelemetryEventName];

// ─── Event categories ─────────────────────────────────────────────────────────

export type TelemetryEventCategory =
  | "navigation"
  | "user_action"
  | "error"
  | "performance";

// ─── Device context ───────────────────────────────────────────────────────────

/**
 * Ambient device / browser metadata captured once per page load and
 * automatically attached to every telemetry event.
 *
 * All fields are non-PII: no IP address, no precise geolocation, no user-
 * identifying hardware fingerprints.  Fields degrade gracefully when the
 * browser API is unavailable (e.g. SSR, headless test environments).
 */
export interface DeviceContext {
  /**
   * navigator.userAgent truncated to 512 characters.
   * Used for browser and OS detection in analytics.
   */
  userAgent: string;

  /**
   * navigator.language (BCP 47 tag, e.g. "en-US").
   * Falls back to "unknown" when unavailable.
   */
  language: string;

  /**
   * Physical screen width in device pixels (screen.width).
   * 0 when unavailable (SSR / headless).
   */
  screenWidth: number;

  /**
   * Physical screen height in device pixels (screen.height).
   * 0 when unavailable (SSR / headless).
   */
  screenHeight: number;

  /**
   * Viewport width in CSS pixels (window.innerWidth).
   * 0 when unavailable (SSR / headless).
   */
  viewportWidth: number;

  /**
   * Viewport height in CSS pixels (window.innerHeight).
   * 0 when unavailable (SSR / headless).
   */
  viewportHeight: number;

  /**
   * True when the device has at least one registered touch point
   * (navigator.maxTouchPoints > 0).  Used to distinguish mobile/tablet
   * from desktop in the SCAN app.
   */
  touchSupport: boolean;

  /**
   * Effective connection type from the NetworkInformation API
   * (e.g. "4g", "3g", "2g", "slow-2g", "wifi").
   * Falls back to "unknown" when the API is unavailable.
   */
  connectionType: string;

  /**
   * Device pixel ratio (window.devicePixelRatio).
   * Useful for diagnosing high-DPI rendering issues.
   * Defaults to 1 when unavailable.
   */
  devicePixelRatio: number;
}

// ─── Common base ──────────────────────────────────────────────────────────────

/**
 * Fields present on every telemetry event regardless of category.
 *
 * Consumers should never need to cast — the discriminated unions below
 * extend this base with the category-specific payload fields.
 */
export interface TelemetryEventBase {
  /** Category discriminator — use this first in `switch` statements. */
  eventCategory: TelemetryEventCategory;
  /** Specific event name within the category. */
  eventName: TelemetryEventNameValue;
  /** Which app surface fired this event. */
  app: TelemetryApp;
  /** Epoch milliseconds at time of event. */
  timestamp: number;
  /**
   * Browser / session identifier (ephemeral, non-PII).
   * Generated once per page load and stored in sessionStorage.
   */
  sessionId: string;
  /**
   * Kinde user ID of the authenticated user.
   * Omit (undefined) only for unauthenticated error/perf events.
   */
  userId?: string;
  /**
   * Convex record ID of the case in focus at the time of the event.
   * Null when no case is selected.
   */
  caseId?: string | null;

  /**
   * Ambient device / browser metadata captured at page load.
   *
   * Automatically injected by `TelemetryClient.track()` — callers do NOT
   * need to provide this field.  It can be overridden per-event if needed
   * (e.g. in tests that inject a deterministic device context).
   *
   * Absent when the event is emitted in an SSR context or a headless test
   * environment where `window` is unavailable.
   */
  device?: DeviceContext;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION EVENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── INVENTORY navigation payloads ──────────────────────────────────────────

export interface InvNavMapViewChangedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED;
  app: "inventory";
  /** The map mode being navigated to. */
  mapView: "M1" | "M2" | "M3" | "M4" | "M5";
  /** The map mode being navigated from (null on first load). */
  previousMapView: "M1" | "M2" | "M3" | "M4" | "M5" | null;
}

export interface InvNavCaseSelectedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.INV_NAV_CASE_SELECTED;
  app: "inventory";
  caseId: string;
  /** The active map mode when selection occurred. */
  mapView: "M1" | "M2" | "M3" | "M4" | "M5";
  /** Source of selection — pin click vs. list click vs. deep-link. */
  selectionSource: "map_pin" | "list_item" | "deep_link" | "search";
}

export interface InvNavCaseDeselectedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.INV_NAV_CASE_DESELECTED;
  app: "inventory";
  /** The case ID that was deselected. */
  previousCaseId: string;
}

export interface InvNavDetailTabChangedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.INV_NAV_DETAIL_TAB_CHANGED;
  app: "inventory";
  /** The tab being navigated to. */
  tab: "T1" | "T2" | "T3" | "T4" | "T5";
  /** The tab being navigated from. */
  previousTab: "T1" | "T2" | "T3" | "T4" | "T5" | null;
  caseId: string;
}

export interface InvNavPageLoadedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.INV_NAV_PAGE_LOADED;
  app: "inventory";
  /** Milliseconds from navigation start to interactive. */
  loadDurationMs: number;
  /** Whether the page was hydrated from URL state (deep-link). */
  hydratedFromUrl: boolean;
}

// ── SCAN navigation payloads ───────────────────────────────────────────────

export interface ScanNavPageChangedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.SCAN_NAV_PAGE_CHANGED;
  app: "scan";
  /** Route path navigated to (e.g. "/scan/[caseId]/inspect"). */
  toPath: string;
  /** Route path navigated from (null on first load). */
  fromPath: string | null;
}

export interface ScanNavCaseOpenedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.SCAN_NAV_CASE_OPENED;
  app: "scan";
  caseId: string;
  /** Current case status at time of open. */
  caseStatus:
    | "assembled"
    | "deployed"
    | "in_field"
    | "shipping"
    | "returned";
}

export interface ScanNavInspectionStartedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.SCAN_NAV_INSPECTION_STARTED;
  app: "scan";
  caseId: string;
  /** Number of manifest items in the checklist. */
  totalItems: number;
}

export interface ScanNavDamageReportOpenedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.SCAN_NAV_DAMAGE_REPORT_OPENED;
  app: "scan";
  caseId: string;
  /**
   * Convex manifestItem ID when reporting damage on a specific item.
   * Null for a case-level photo.
   */
  manifestItemId: string | null;
}

export interface ScanNavShipFlowOpenedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.SCAN_NAV_SHIP_FLOW_OPENED;
  app: "scan";
  caseId: string;
}

export interface ScanNavCustodyFlowOpenedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED;
  app: "scan";
  caseId: string;
}

export interface ScanNavPageLoadedEvent extends TelemetryEventBase {
  eventCategory: "navigation";
  eventName: typeof TelemetryEventName.SCAN_NAV_PAGE_LOADED;
  app: "scan";
  /** Milliseconds from navigation start to interactive. */
  loadDurationMs: number;
}

/** Discriminated union of all navigation events. */
export type NavigationEvent =
  | InvNavMapViewChangedEvent
  | InvNavCaseSelectedEvent
  | InvNavCaseDeselectedEvent
  | InvNavDetailTabChangedEvent
  | InvNavPageLoadedEvent
  | ScanNavPageChangedEvent
  | ScanNavCaseOpenedEvent
  | ScanNavInspectionStartedEvent
  | ScanNavDamageReportOpenedEvent
  | ScanNavShipFlowOpenedEvent
  | ScanNavCustodyFlowOpenedEvent
  | ScanNavPageLoadedEvent;

// ─────────────────────────────────────────────────────────────────────────────
// USER ACTION EVENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── INVENTORY action payloads ──────────────────────────────────────────────

export interface InvActionLayerToggledEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.INV_ACTION_LAYER_TOGGLED;
  app: "inventory";
  layerId:
    | "cases"
    | "clusters"
    | "transit"
    | "sites"
    | "heat"
    | "labels"
    | "satellite"
    | "terrain";
  /** Whether the layer was enabled (true) or disabled (false). */
  enabled: boolean;
  /** Full set of active layer IDs after the toggle. */
  activeLayers: string[];
}

export interface InvActionFilterOrgChangedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.INV_ACTION_FILTER_ORG_CHANGED;
  app: "inventory";
  /** The new org Convex ID, or null when filter was cleared. */
  orgId: string | null;
  /** The previous org Convex ID, or null when there was no filter. */
  previousOrgId: string | null;
}

export interface InvActionFilterKitChangedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.INV_ACTION_FILTER_KIT_CHANGED;
  app: "inventory";
  /** The new kit (template) Convex ID, or null when filter was cleared. */
  kitId: string | null;
  /** The previous kit Convex ID, or null when there was no filter. */
  previousKitId: string | null;
}

export interface InvActionMissionReplayScrubbedEvent
  extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.INV_ACTION_MISSION_REPLAY_SCRUBBED;
  app: "inventory";
  /**
   * Epoch ms of the scrubber position after scrubbing stopped.
   * (Debounced — only final position is recorded, not every drag frame.)
   */
  replayTimestamp: number;
  /** Convex ID of the mission being replayed. */
  missionId: string;
}

export interface InvActionExportInitiatedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.INV_ACTION_EXPORT_INITIATED;
  app: "inventory";
  /** Type of export triggered. */
  exportType: "label_pdf" | "manifest_csv" | "event_log_csv" | "qr_code_png";
  caseId: string;
}

export interface InvActionCaseCreateOpenedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.INV_ACTION_CASE_CREATE_OPENED;
  app: "inventory";
  /** Entry point that triggered the create flow. */
  source: "header_button" | "map_context_menu" | "keyboard_shortcut";
}

export interface InvActionTemplateAppliedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.INV_ACTION_TEMPLATE_APPLIED;
  app: "inventory";
  caseId: string;
  /** The template Convex ID that was applied. */
  templateId: string;
  /** Number of manifest items the template defines. */
  templateItemCount: number;
}

// ── SCAN action payloads ───────────────────────────────────────────────────

export interface ScanActionQrScannedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_QR_SCANNED;
  app: "scan";
  /** Whether the scan produced a valid decodable result. */
  success: boolean;
  /**
   * Duration from camera open to first decode result (ms).
   * Null when the scan failed with no decode at all.
   */
  scanDurationMs: number | null;
  /**
   * Decoded payload value.
   * Omit (undefined) when the scan failed.
   * Truncated to 256 chars to bound payload size.
   */
  qrPayload?: string;
  /** How the scan was triggered. */
  method: "camera" | "manual_entry";
}

export interface ScanActionItemCheckedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_ITEM_CHECKED;
  app: "scan";
  caseId: string;
  /** Convex manifestItem ID. */
  manifestItemId: string;
  /** Stable template item ID. */
  templateItemId: string;
  /** New check state. */
  newStatus: "unchecked" | "ok" | "damaged" | "missing";
  /** Previous check state. */
  previousStatus: "unchecked" | "ok" | "damaged" | "missing";
  /** Index of the item in the checklist (0-based). */
  itemIndex: number;
  /** Total items in the checklist. */
  totalItems: number;
}

export interface ScanActionDamageReportedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_DAMAGE_REPORTED;
  app: "scan";
  caseId: string;
  /**
   * Convex manifestItem ID when damage is on a specific item.
   * Null for case-level damage photos.
   */
  manifestItemId: string | null;
  /** Damage severity assessed by the technician. */
  severity: "minor" | "moderate" | "severe";
  /** Number of annotation pins placed on the photo. */
  annotationCount: number;
  /** Whether free-text notes were included. */
  hasNotes: boolean;
  /** Photo file size in bytes (approximate). */
  photoSizeBytes: number;
}

export interface ScanActionTrackingEnteredEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_TRACKING_ENTERED;
  app: "scan";
  caseId: string;
  /** Whether the tracking number passed basic format validation. */
  valid: boolean;
  /** Length of the entered tracking number (value not recorded for privacy). */
  trackingNumberLength: number;
}

export interface ScanActionShipmentSubmittedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_SHIPMENT_SUBMITTED;
  app: "scan";
  caseId: string;
  /** Whether the Convex mutation succeeded. */
  success: boolean;
  /** Carrier — always "FedEx" in current implementation. */
  carrier: "FedEx";
  /**
   * The FedEx tracking number recorded for this shipment (spec §23).
   * Captured only on success (when `success` is true).
   * Omitted when the mutation failed so no partial/invalid value is logged.
   */
  trackingNumber?: string;
  /**
   * Kinde user ID of the technician who initiated the shipment (spec §23).
   * Captured from the authenticated session; falls back to "scan-user" while
   * the Kinde integration is pending.
   */
  initiatingUserId?: string;
}

/**
 * Classification of a custody handoff as captured in spec §23.
 *
 * peer_to_peer       — direct transfer between two field personnel
 * return             — case being returned to base / warehouse
 * initial_assignment — case assigned for the first time (no prior holder)
 * field_transfer     — in-field transfer at a work-site / deployment location
 */
export type HandoffType =
  | "peer_to_peer"
  | "return"
  | "initial_assignment"
  | "field_transfer";

export interface ScanActionCustodyInitiatedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED;
  app: "scan";
  caseId: string;
  /** Kinde user ID of the recipient. */
  recipientUserId: string;
  /**
   * Classification of the handoff (spec §23).
   * Captured from the handoff type selector in the SCAN app form.
   * Defaults to "peer_to_peer" when not explicitly selected.
   */
  handoffType: HandoffType;
  /**
   * Kinde user ID of the outgoing custodian (spec §23).
   * Populated from the authenticated session at form submission time.
   */
  fromUserId: string;
}

export interface ScanActionCustodyCompletedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED;
  app: "scan";
  caseId: string;
  /** Kinde user ID of the previous holder (spec §23: from-custodian). */
  fromUserId: string;
  /** Display name of the outgoing custodian. */
  fromUserName: string;
  /** Kinde user ID of the new holder (spec §23: to-custodian). */
  toUserId: string;
  /** Display name of the incoming custodian. */
  toUserName: string;
  /**
   * Classification of the handoff (spec §23: handoff type).
   * Matches the value emitted by the preceding SCAN_ACTION_CUSTODY_INITIATED event.
   */
  handoffType: HandoffType;
  /** Whether a signature image was captured. */
  hasSignature: boolean;
  /** Duration from flow open to completion (ms). */
  handoffDurationMs: number;
  /**
   * Epoch ms when the handoff was recorded (spec §23: timestamp).
   * This is the client-side handoffAt value passed to the Convex mutation;
   * the event's `timestamp` field (auto-filled) captures when the event was emitted.
   */
  handoffAt: number;
}

export interface ScanActionInspectionCompletedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_INSPECTION_COMPLETED;
  app: "scan";
  caseId: string;
  /** Convex inspection record ID. */
  inspectionId: string;
  /** Total number of manifest items. */
  totalItems: number;
  /** Items marked ok. */
  okItems: number;
  /** Items marked damaged. */
  damagedItems: number;
  /** Items marked missing. */
  missingItems: number;
  /** Duration from start to completion (ms). */
  durationMs: number;
}

export interface ScanActionNoteAddedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_NOTE_ADDED;
  app: "scan";
  caseId: string;
  /** Note length in characters. */
  noteLength: number;
  /**
   * Whether the note was attached to a specific manifest item or
   * the case itself.
   */
  attachedTo: "case" | "manifest_item";
}

/**
 * Emitted when the technician places an annotation pin on a damage photo
 * in the SCAN markup tool (spec §23).
 *
 * This event fires once per individual pin placement — before the photo is
 * uploaded, so `photoId` is a client-generated temporary identifier and
 * `reportId` is null.  The final `SCAN_ACTION_DAMAGE_REPORTED` event (fired
 * on submission) carries the authoritative `damageReportId` from Convex.
 */
export interface ScanActionAnnotationAddedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_ANNOTATION_ADDED;
  app: "scan";
  caseId: string;
  /**
   * Category of annotation shape placed on the photo.
   * Currently always "pin"; reserved for future annotation types
   * (e.g. "arrow", "highlight", "freehand").
   */
  annotationType: "pin";
  /**
   * Client-generated temporary identifier for the current photo session.
   * Generated when the technician selects or captures a photo; stable until
   * the next photo capture.  Not a Convex storage ID — the storage ID is
   * not available until after the photo is uploaded.
   */
  photoId: string;
  /**
   * The Convex damage report ID.  Null before submission (annotations are
   * placed before the form is submitted and the report row is created).
   */
  reportId: string | null;
  /** Text label entered by the technician for this annotation pin. */
  annotationLabel: string;
  /** 0-based index of this annotation in the current annotation list. */
  annotationIndex: number;
}

/**
 * Emitted when the technician removes an annotation pin from a damage photo
 * in the SCAN markup tool (spec §23).
 *
 * Fires once per individual pin removal — before submission, so `photoId`
 * is the same client-generated temporary ID as in the corresponding
 * `SCAN_ACTION_ANNOTATION_ADDED` event and `reportId` is null.
 */
export interface ScanActionAnnotationRemovedEvent extends TelemetryEventBase {
  eventCategory: "user_action";
  eventName: typeof TelemetryEventName.SCAN_ACTION_ANNOTATION_REMOVED;
  app: "scan";
  caseId: string;
  /**
   * Category of annotation shape removed.
   * Currently always "pin".
   */
  annotationType: "pin";
  /**
   * Client-generated temporary photo session ID (matches the corresponding
   * `SCAN_ACTION_ANNOTATION_ADDED` event for the same photo session).
   */
  photoId: string;
  /**
   * The Convex damage report ID.  Null before submission.
   */
  reportId: string | null;
  /** Text label of the annotation pin that was removed. */
  annotationLabel: string;
  /** 0-based index of the removed pin in the annotations list before removal. */
  annotationIndex: number;
}

/** Discriminated union of all user action events. */
export type UserActionEvent =
  | InvActionLayerToggledEvent
  | InvActionFilterOrgChangedEvent
  | InvActionFilterKitChangedEvent
  | InvActionMissionReplayScrubbedEvent
  | InvActionExportInitiatedEvent
  | InvActionCaseCreateOpenedEvent
  | InvActionTemplateAppliedEvent
  | ScanActionQrScannedEvent
  | ScanActionItemCheckedEvent
  | ScanActionDamageReportedEvent
  | ScanActionTrackingEnteredEvent
  | ScanActionShipmentSubmittedEvent
  | ScanActionCustodyInitiatedEvent
  | ScanActionCustodyCompletedEvent
  | ScanActionInspectionCompletedEvent
  | ScanActionNoteAddedEvent
  | ScanActionAnnotationAddedEvent
  | ScanActionAnnotationRemovedEvent;

// ─────────────────────────────────────────────────────────────────────────────
// ERROR EVENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common fields shared across all error events.
 *
 * `errorCode` is a stable machine-readable identifier for the failure mode
 * (e.g. "CAMERA_NOT_FOUND"), distinct from the human-readable `errorMessage`.
 */
export interface ErrorEventBase extends TelemetryEventBase {
  eventCategory: "error";
  /** Stable error code — use for programmatic grouping in analytics. */
  errorCode: string;
  /** Human-readable description of the error. Truncated to 512 chars. */
  errorMessage: string;
  /**
   * Whether the error was recoverable (user can retry / continue) or
   * unrecoverable (requires page reload or re-authentication).
   */
  recoverable: boolean;
}

export interface ErrorQrScanFailedEvent extends ErrorEventBase {
  eventName: typeof TelemetryEventName.ERROR_QR_SCAN_FAILED;
  /** Duration camera was open before the failure was declared (ms). */
  attemptDurationMs: number;
}

export interface ErrorCameraDeniedEvent extends ErrorEventBase {
  eventName: typeof TelemetryEventName.ERROR_CAMERA_DENIED;
  /** Which browser permission was denied. */
  permissionName: "camera";
}

export interface ErrorPhotoUploadFailedEvent extends ErrorEventBase {
  eventName: typeof TelemetryEventName.ERROR_PHOTO_UPLOAD_FAILED;
  caseId: string;
  /** File size in bytes (for diagnosing size-limit failures). */
  fileSizeBytes: number;
  /** HTTP status code from the upload request, if available. */
  httpStatus: number | null;
}

export interface ErrorConvexQueryFailedEvent extends ErrorEventBase {
  eventName: typeof TelemetryEventName.ERROR_CONVEX_QUERY_FAILED;
  /**
   * Name of the Convex function that failed (e.g. "cases:getCaseById").
   * Matches the path in the Convex API object.
   */
  functionName: string;
  /**
   * Whether this was a query (read) or mutation (write).
   */
  operationType: "query" | "mutation" | "action";
}

export interface ErrorFedexValidationFailedEvent extends ErrorEventBase {
  eventName: typeof TelemetryEventName.ERROR_FEDEX_VALIDATION_FAILED;
  caseId: string;
  /** Length of the submitted tracking number (value not logged for PII). */
  trackingNumberLength: number;
  /** Validation rule that failed. */
  validationRule: "format" | "length" | "checksum" | "unknown";
}

export interface ErrorNetworkRequestFailedEvent extends ErrorEventBase {
  eventName: typeof TelemetryEventName.ERROR_NETWORK_REQUEST_FAILED;
  /** URL path (no query params, no sensitive data). */
  urlPath: string;
  /** HTTP status code or null if the request never completed. */
  httpStatus: number | null;
  /** Whether the failure was a timeout. */
  isTimeout: boolean;
}

export interface ErrorFeatureFlagLoadFailedEvent extends ErrorEventBase {
  eventName: typeof TelemetryEventName.ERROR_FEATURE_FLAG_LOAD_FAILED;
  /** The feature flag key that failed to load. */
  flagKey: string;
}

export interface ErrorUnhandledExceptionEvent extends ErrorEventBase {
  eventName: typeof TelemetryEventName.ERROR_UNHANDLED_EXCEPTION;
  /**
   * Condensed stack trace (first 1024 chars, paths stripped).
   * Never includes user data.
   */
  stackTrace: string | null;
  /** React component boundary that caught the error, if applicable. */
  errorBoundary: string | null;
}

/** Discriminated union of all error events. */
export type ErrorEvent =
  | ErrorQrScanFailedEvent
  | ErrorCameraDeniedEvent
  | ErrorPhotoUploadFailedEvent
  | ErrorConvexQueryFailedEvent
  | ErrorFedexValidationFailedEvent
  | ErrorNetworkRequestFailedEvent
  | ErrorFeatureFlagLoadFailedEvent
  | ErrorUnhandledExceptionEvent;

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE EVENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common fields shared across all performance events.
 *
 * All durations are in milliseconds.  Percentile targets referenced in
 * field-level comments come from the evaluation criteria:
 *   - Map endpoint p50: < 200 ms
 *   - Real-time fidelity: ≤ 2 000 ms
 *   - Map replay: 60 fps
 */
export interface PerformanceEventBase extends TelemetryEventBase {
  eventCategory: "performance";
  /** Duration of the measured operation in milliseconds. */
  durationMs: number;
  /**
   * Whether the measurement was within the acceptable threshold.
   * Allows alerting pipelines to filter without recomputing thresholds.
   */
  withinTarget: boolean;
}

export interface PerfMapRenderEvent extends PerformanceEventBase {
  eventName: typeof TelemetryEventName.PERF_MAP_RENDER;
  app: "inventory";
  /** Map mode being rendered. */
  mapView: "M1" | "M2" | "M3" | "M4" | "M5";
  /** Number of case features rendered (pins + clusters). */
  featureCount: number;
  /**
   * Rendering strategy used.
   * "css_pin" for < 200 cases, "cluster" for ≥ 200 cases.
   */
  renderStrategy: "css_pin" | "cluster";
}

export interface PerfQueryResponseEvent extends PerformanceEventBase {
  eventName: typeof TelemetryEventName.PERF_QUERY_RESPONSE;
  /**
   * Name of the Convex function (e.g. "cases:listCases").
   * Matches the path in the Convex API object.
   */
  functionName: string;
  /** Number of records returned by the query. */
  resultCount: number | null;
  /** Whether the result was served from Convex's reactive cache. */
  fromCache: boolean;
}

export interface PerfNavigationTimingEvent extends PerformanceEventBase {
  eventName: typeof TelemetryEventName.PERF_NAVIGATION_TIMING;
  /**
   * Navigation timing metric name.
   * Aligns with PerformanceNavigationTiming / Web Vitals naming.
   */
  metric:
    | "TTFB"   // Time to First Byte
    | "FCP"    // First Contentful Paint
    | "LCP"    // Largest Contentful Paint
    | "FID"    // First Input Delay
    | "CLS"    // Cumulative Layout Shift (score, not ms — stored in durationMs as ×1000)
    | "INP";   // Interaction to Next Paint
  /** Route path where the measurement was taken. */
  routePath: string;
}

export interface PerfRealtimeLatencyEvent extends PerformanceEventBase {
  eventName: typeof TelemetryEventName.PERF_REALTIME_LATENCY;
  /**
   * The SCAN app mutation that triggered the latency measurement.
   * e.g. "scan:submitDamagePhoto"
   */
  triggerMutation: string;
  /**
   * Epoch ms when the mutation was submitted from SCAN.
   * Used as the start point for the latency measurement.
   */
  mutationSubmittedAt: number;
  /**
   * Epoch ms when the INVENTORY subscription update was received.
   * Used as the end point for the latency measurement.
   */
  subscriptionUpdatedAt: number;
  /**
   * Whether the update was received within the 2-second fidelity target.
   * Duplicates `withinTarget` for clarity at query time.
   */
  withinFidelityTarget: boolean;
}

export interface PerfPhotoUploadEvent extends PerformanceEventBase {
  eventName: typeof TelemetryEventName.PERF_PHOTO_UPLOAD;
  app: "scan";
  caseId: string;
  /** File size in bytes. */
  fileSizeBytes: number;
  /** Upload throughput in kB/s (fileSizeBytes / durationMs × 1000 / 1024). */
  throughputKbps: number;
}

export interface PerfMapEndpointEvent extends PerformanceEventBase {
  eventName: typeof TelemetryEventName.PERF_MAP_ENDPOINT;
  app: "inventory";
  /** Map mode that triggered the endpoint request. */
  mapView: "M1" | "M2" | "M3" | "M4" | "M5";
  /** Number of cases returned in the response. */
  caseCount: number;
  /** Target: < 200 ms p50. */
  withinTarget: boolean;
}

/** Discriminated union of all performance events. */
export type PerformanceEvent =
  | PerfMapRenderEvent
  | PerfQueryResponseEvent
  | PerfNavigationTimingEvent
  | PerfRealtimeLatencyEvent
  | PerfPhotoUploadEvent
  | PerfMapEndpointEvent;

// ─────────────────────────────────────────────────────────────────────────────
// TOP-LEVEL UNION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete discriminated union of every telemetry event emitted by
 * INVENTORY or SCAN.
 *
 * Discriminate first on `eventCategory`, then on `eventName`:
 *
 * @example
 * function handle(event: TelemetryEvent) {
 *   switch (event.eventCategory) {
 *     case "navigation":
 *       switch (event.eventName) {
 *         case TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED:
 *           // event is narrowed to InvNavMapViewChangedEvent
 *           console.log(event.mapView);
 *           break;
 *       }
 *       break;
 *     case "error":
 *       if (!event.recoverable) alertOps(event);
 *       break;
 *   }
 * }
 */
export type TelemetryEvent =
  | NavigationEvent
  | UserActionEvent
  | ErrorEvent
  | PerformanceEvent;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract all TelemetryEvent variants for a specific app.
 *
 * @example
 * type ScanEvents = TelemetryEventsForApp<"scan">;
 */
export type TelemetryEventsForApp<A extends TelemetryApp> = Extract<
  TelemetryEvent,
  { app: A }
>;

/**
 * Extract all TelemetryEvent variants for a specific category.
 *
 * @example
 * type Errors = TelemetryEventsForCategory<"error">;
 */
export type TelemetryEventsForCategory<C extends TelemetryEventCategory> =
  Extract<TelemetryEvent, { eventCategory: C }>;

/**
 * Narrow a TelemetryEvent to the specific event type for a given name.
 *
 * @example
 * type MapViewEvent = TelemetryEventByName<
 *   typeof TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED
 * >;
 * // → InvNavMapViewChangedEvent
 */
export type TelemetryEventByName<N extends TelemetryEventNameValue> = Extract<
  TelemetryEvent,
  { eventName: N }
>;

/**
 * Minimum required fields for constructing a telemetry event.
 * All `TelemetryEventBase` fields except `timestamp` (auto-set by emitter).
 */
export type TelemetryEventInput<E extends TelemetryEvent> = Omit<
  E,
  "timestamp"
> & { timestamp?: number };
