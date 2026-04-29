/**
 * lib/telemetry/index.ts
 *
 * Singleton telemetry transport layer for INVENTORY and SCAN.
 *
 * Composes TelemetryQueue (queue.ts) and the environment-aware sink router
 * (router.ts) into a ready-to-use enriched client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Architecture
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Singleton queue
 * ───────────────
 *   A single `TelemetryQueue` is created at module load time.  It uses an
 *   *indirect* send function that delegates to a mutable `_currentSink`
 *   variable.  This design lets the production Convex mutation be injected at
 *   runtime (via `initTelemetry()`) without tearing down and recreating the
 *   queue — the timer, lifecycle handlers, and retry configuration remain stable.
 *
 *   Sink selection by environment:
 *     test        → no-op   (events buffered but never sent; safe for unit tests)
 *     development → console (events logged to DevTools via console.groupCollapsed)
 *     production  → no-op   until `initTelemetry({ convexMutateAsync })` is called,
 *                   then Convex (direct mutation, bypasses the HTTP proxy)
 *
 * Event enrichment
 * ────────────────
 *   `track()` automatically fills in fields that the caller need not supply:
 *     • `timestamp`  — `Date.now()`
 *     • `sessionId`  — per-page-load UUID (persisted in sessionStorage)
 *     • `userId`     — from the last `identify()` call (undefined for anon)
 *     • `device`     — captured from browser globals once at module load
 *   Any of these can be overridden by passing the field explicitly in `input`.
 *
 * Typed track helpers
 * ────────────────────
 *   Four category-specific helpers narrow the TelemetryEvent union so TypeScript
 *   enforces correct field shapes at every call site:
 *     trackNavigation(input)  — eventCategory: "navigation"
 *     trackUserAction(input)  — eventCategory: "user_action"
 *     trackError(input)       — eventCategory: "error"
 *     trackPerformance(input) — eventCategory: "performance"
 *
 * App entry-point integration
 * ────────────────────────────
 *   Call `initTelemetry({ convexMutateAsync })` from a React client component
 *   that has a ConvexProvider ancestor (e.g. inside `providers.tsx`).  After
 *   that call all future queue flushes are delivered directly via the Convex
 *   mutation, bypassing the /api/telemetry HTTP proxy.
 *
 *   `identify(userId)` associates the authenticated Kinde user ID with all
 *   subsequent events.  Call it whenever the user object becomes available.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage — application code
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @example
 * // Typed helper (preferred):
 * import { trackNavigation, TelemetryEventName } from "@/lib/telemetry";
 *
 * trackNavigation({
 *   eventCategory: "navigation",
 *   eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
 *   app: "scan",
 *   toPath: "/scan/abc123/inspect",
 *   fromPath: "/scan",
 * });
 *
 * @example
 * // Generic track():
 * import { track } from "@/lib/telemetry";
 *
 * track({
 *   eventCategory: "user_action",
 *   eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
 *   app: "scan",
 *   success: true,
 *   scanDurationMs: 350,
 *   method: "camera",
 * });
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage — initialization (call once from a React client component)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @example
 * // providers.tsx or any "use client" component with ConvexProvider:
 * import { useMutation } from "convex/react";
 * import { api } from "@/convex/_generated/api";
 * import { initTelemetry, identify } from "@/lib/telemetry";
 *
 * function TelemetryInitializer() {
 *   const recordBatch = useMutation(api.telemetry.recordTelemetryBatch);
 *   const { user } = useKindeBrowserClient();
 *
 *   useEffect(() => {
 *     initTelemetry({ convexMutateAsync: recordBatch });
 *   }, [recordBatch]);
 *
 *   useEffect(() => {
 *     if (user?.id) identify(user.id);
 *   }, [user?.id]);
 *
 *   return null;
 * }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Testing
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @example
 * // Override the sink in tests using getQueue().drain():
 * import { getQueue } from "@/lib/telemetry";
 *
 * afterEach(() => getQueue().drain()); // clear buffer between tests
 *
 * test("emits SCAN_ACTION_QR_SCANNED", () => {
 *   track({ eventCategory: "user_action", eventName: ..., ... });
 *   const events = getQueue().drain();
 *   expect(events[0].eventName).toBe(TelemetryEventName.SCAN_ACTION_QR_SCANNED);
 * });
 */

import { TelemetryQueue } from "./queue";
import type { TelemetryQueueSendFn } from "./queue";
import {
  createNoopSink,
  createConsoleSink,
  createConvexSink,
  type ConvexMutateAsync,
} from "./router";
import {
  resolveTransportMode,
  getOrCreateSessionId,
  getDeviceContext,
  generateUUID,
  MAX_BATCH_SIZE,
  FLUSH_INTERVAL_MS,
} from "@/lib/telemetry.lib";
import type {
  TelemetryEvent,
  DeviceContext,
  NavigationEvent,
  UserActionEvent,
  ErrorEvent,
  PerformanceEvent,
} from "@/types/telemetry.types";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Re-exports ───────────────────────────────────────────────────────────────

// Convenience re-exports so consumers import from a single entry point.
export { TelemetryEventName };
export type { ConvexMutateAsync };
export type {
  TelemetryEvent,
  NavigationEvent,
  UserActionEvent,
  ErrorEvent,
  PerformanceEvent,
  DeviceContext,
} from "@/types/telemetry.types";

// ─── Distributive-Omit helper ─────────────────────────────────────────────────

/**
 * Distributive Omit — applies Omit to each member of a union independently.
 *
 * TypeScript's built-in `Omit<Union, Keys>` collapses the union to an
 * intersection of common keys, losing discriminated-union narrowing.
 * This version distributes correctly:
 *   DistOmit<A | B, "x"> → Omit<A, "x"> | Omit<B, "x">
 */
type DistOmit<T, K extends string | number | symbol> = T extends unknown
  ? Omit<T, K>
  : never;

/** Fields that `track()` auto-fills — callers may omit or override these. */
type AutoFilledFields = "timestamp" | "sessionId" | "userId" | "device";

// ─── Typed input types ────────────────────────────────────────────────────────

/** Auto-fill overrides that any typed input accepts. */
interface AutoFillOverrides {
  /** Override the auto-generated timestamp (epoch ms). */
  timestamp?: number;
  /** Override the auto-assigned session ID. */
  sessionId?: string;
  /** Override the userId from the active identity. */
  userId?: string;
  /** Override the auto-captured device context. */
  device?: DeviceContext;
}

/** Input type for `trackNavigation()`. */
export type NavigationInput = DistOmit<NavigationEvent, AutoFilledFields> &
  AutoFillOverrides;

/** Input type for `trackUserAction()`. */
export type UserActionInput = DistOmit<UserActionEvent, AutoFilledFields> &
  AutoFillOverrides;

/** Input type for `trackError()`. */
export type ErrorInput = DistOmit<ErrorEvent, AutoFilledFields> &
  AutoFillOverrides;

/** Input type for `trackPerformance()`. */
export type PerformanceInput = DistOmit<PerformanceEvent, AutoFilledFields> &
  AutoFillOverrides;

/** Union of all typed input types (used by the generic `track()`). */
export type TelemetryTrackInput =
  | NavigationInput
  | UserActionInput
  | ErrorInput
  | PerformanceInput;

// ─── Module-level singleton state ─────────────────────────────────────────────

/** Kinde user ID from the last `identify()` call. */
let _userId: string | undefined;

/**
 * Per-page-load session ID.
 *
 * Generated once and stored in sessionStorage so it survives hard-refresh
 * (F5) but resets on tab close.  Falls back to an in-memory UUID in
 * SSR / private-browsing contexts where sessionStorage is unavailable.
 */
const _sessionId: string = (() => {
  if (typeof window === "undefined") return generateUUID();
  try {
    return getOrCreateSessionId();
  } catch {
    return generateUUID();
  }
})();

/**
 * Ambient device / browser metadata captured once at module load.
 *
 * Undefined in SSR / headless environments where `window` is absent.
 */
const _deviceContext: DeviceContext | undefined = (() => {
  if (typeof window === "undefined") return undefined;
  try {
    return getDeviceContext();
  } catch {
    return undefined;
  }
})();

// ─── Mutable sink (supports runtime Convex injection) ─────────────────────────

/**
 * The currently active send function.
 *
 * Resolved at module load from NODE_ENV:
 *   test        → no-op    (events silently discarded; use `getQueue().drain()` in tests)
 *   development → console  (events logged to DevTools)
 *   production  → no-op    until `initTelemetry({ convexMutateAsync })` is called,
 *                 then Convex direct mutation
 *
 * Replacing `_currentSink` at runtime (via `initTelemetry()`) is safe because
 * the singleton queue delegates to `_currentSink` through the `_dispatchSink`
 * closure — no queue teardown required.
 */
let _currentSink: TelemetryQueueSendFn = (() => {
  const mode = resolveTransportMode();
  if (mode === "noop") return createNoopSink();
  if (mode === "console") return createConsoleSink();
  // Production: start with no-op; swapped for Convex on initTelemetry().
  // Events enqueued before initTelemetry are held in the in-memory buffer and
  // will be delivered by the next timer flush after the sink is swapped.
  return createNoopSink();
})();

// ─── Singleton queue ──────────────────────────────────────────────────────────

/**
 * Indirect dispatch function — delegates to `_currentSink` by reference.
 *
 * Because `TelemetryQueue` binds the `send` callback at construction time,
 * using this closure allows the sink to be replaced later (e.g. when the
 * Convex mutation becomes available) without recreating the queue instance.
 *
 * Closure captures `_currentSink` by name so the latest value is always used.
 */
const _dispatchSink: TelemetryQueueSendFn = (batch) => _currentSink(batch);

/**
 * The module-level singleton queue.
 *
 * All `track*()` calls enqueue into this queue.  Lifecycle handlers (flush on
 * `beforeunload` and `visibilitychange`) are registered only in browser contexts.
 * The periodic flush timer is suppressed in SSR to avoid Node.js process leaks.
 */
const _queue = new TelemetryQueue({
  send: _dispatchSink,
  maxBatchSize: MAX_BATCH_SIZE,
  flushIntervalMs:
    typeof window !== "undefined" ? FLUSH_INTERVAL_MS : 0,
  registerLifecycleHandlers: typeof window !== "undefined",
});

// ─── Initialization API ───────────────────────────────────────────────────────

/**
 * Options accepted by `initTelemetry()`.
 */
export interface InitTelemetryOptions {
  /**
   * The Convex mutation function for batch delivery.
   *
   * Obtain via `useMutation(api.telemetry.recordTelemetryBatch)` inside a
   * React component that has a ConvexProvider ancestor.
   *
   * After this is provided, all subsequent queue flushes bypass the
   * /api/telemetry HTTP proxy and deliver events directly to Convex.
   */
  convexMutateAsync: ConvexMutateAsync;

  /**
   * Optionally identify the current user at init time.
   *
   * Equivalent to calling `identify(userId)` immediately after `initTelemetry()`.
   * Provided as a convenience to avoid a separate call site.
   */
  userId?: string;
}

/**
 * Wire up the production Convex mutation as the telemetry delivery sink.
 *
 * Call this once from a React client component that has access to both the
 * Convex mutation (via `useMutation`) and the authenticated user identity.
 * After this call, all buffered events will be flushed through Convex on the
 * next timer tick (within `FLUSH_INTERVAL_MS`, default 5 seconds).
 *
 * Safe to call multiple times — later calls replace the sink and optionally
 * update the user identity.  Idempotent when called with the same arguments.
 *
 * @param options  See `InitTelemetryOptions`.
 *
 * @example
 * // In providers.tsx or any "use client" component:
 * import { useMutation } from "convex/react";
 * import { api } from "@/convex/_generated/api";
 * import { initTelemetry } from "@/lib/telemetry";
 *
 * function TelemetryInitializer() {
 *   const recordBatch = useMutation(api.telemetry.recordTelemetryBatch);
 *   useEffect(() => {
 *     initTelemetry({ convexMutateAsync: recordBatch });
 *   }, [recordBatch]);
 *   return null;
 * }
 */
export function initTelemetry(options: InitTelemetryOptions): void {
  _currentSink = createConvexSink(options.convexMutateAsync);
  if (options.userId !== undefined) {
    _userId = options.userId;
  }
}

// ─── Identity API ─────────────────────────────────────────────────────────────

/**
 * Associate the current session with a Kinde user ID.
 *
 * All `track*()` calls after this will include `userId` in their payload
 * unless the caller explicitly overrides it with a different value.
 *
 * @param userId  Kinde user ID string (e.g. "kp_abc123...").
 */
export function identify(userId: string): void {
  _userId = userId;
}

/**
 * Return the per-page-load session ID used to group events.
 *
 * Useful when you need to correlate events in an analytics query or
 * when constructing a custom event payload that must reference the session.
 */
export function getSessionId(): string {
  return _sessionId;
}

// ─── Queue access (testing / inspection) ─────────────────────────────────────

/**
 * Return the singleton `TelemetryQueue` instance.
 *
 * Intended for unit tests that need to inspect or drain the in-memory buffer
 * without triggering actual delivery:
 *
 * @example
 * const events = getQueue().drain();
 * expect(events).toHaveLength(1);
 *
 * Do not use in production application code — prefer the `track*()` helpers.
 */
export function getQueue(): TelemetryQueue {
  return _queue;
}

/**
 * Immediately flush all buffered events through the current sink.
 *
 * Returns a Promise that resolves once the flush (and any retry attempts) are
 * complete.  Telemetry failures are always swallowed — the Promise never rejects.
 *
 * Useful in `beforeunload` handlers or teardown code that needs to ensure all
 * pending events are delivered before the page closes.
 */
export function flush(): Promise<void> {
  return _queue.flush();
}

// ─── Core track() ─────────────────────────────────────────────────────────────

/**
 * Enqueue a telemetry event with automatic enrichment.
 *
 * Fields auto-filled when not provided by the caller:
 *   • `timestamp`  — `Date.now()` (epoch ms)
 *   • `sessionId`  — the per-page-load UUID from sessionStorage
 *   • `userId`     — the Kinde user ID from the last `identify()` call
 *   • `device`     — device context captured at module load
 *
 * In `test` mode (NODE_ENV === "test") the event is queued normally but the
 * no-op sink discards it on flush.  Use `getQueue().drain()` to assert on the
 * buffered events in unit tests.
 *
 * @param input  Event payload. The four auto-filled fields are optional.
 *
 * @example
 * track({
 *   eventCategory: "user_action",
 *   eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
 *   app: "scan",
 *   success: true,
 *   scanDurationMs: 350,
 *   method: "camera",
 * });
 */
export function track(input: TelemetryTrackInput): void {
  const event = {
    ...input,
    timestamp: input.timestamp ?? Date.now(),
    sessionId: input.sessionId ?? _sessionId,
    userId: "userId" in input && input.userId !== undefined
      ? input.userId
      : _userId,
    device: "device" in input && input.device !== undefined
      ? input.device
      : _deviceContext,
  } as unknown as TelemetryEvent;

  _queue.enqueue(event);
}

// ─── Typed track helpers ──────────────────────────────────────────────────────

/**
 * Track a navigation event.
 *
 * TypeScript enforces the complete shape for the active event variant
 * (discriminated on `eventName`).
 *
 * Navigation events cover:
 *   • Map mode switches (INV_NAV_MAP_VIEW_CHANGED)
 *   • Case selection / deselection (INV_NAV_CASE_SELECTED / DESELECTED)
 *   • Detail tab changes (INV_NAV_DETAIL_TAB_CHANGED)
 *   • SCAN page changes (SCAN_NAV_PAGE_CHANGED)
 *   • Flow entries (SCAN_NAV_INSPECTION_STARTED, SCAN_NAV_SHIP_FLOW_OPENED, …)
 *
 * @example
 * trackNavigation({
 *   eventCategory: "navigation",
 *   eventName: TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED,
 *   app: "inventory",
 *   mapView: "M3",
 *   previousMapView: "M1",
 * });
 */
export function trackNavigation(input: NavigationInput): void {
  track(input as TelemetryTrackInput);
}

/**
 * Track a user action event.
 *
 * User action events cover intentional interactions:
 *   • QR scans (SCAN_ACTION_QR_SCANNED)
 *   • Checklist item toggles (SCAN_ACTION_ITEM_CHECKED)
 *   • Damage reports (SCAN_ACTION_DAMAGE_REPORTED)
 *   • Shipment submissions (SCAN_ACTION_SHIPMENT_SUBMITTED)
 *   • Custody handoffs (SCAN_ACTION_CUSTODY_INITIATED / COMPLETED)
 *   • Layer toggles (INV_ACTION_LAYER_TOGGLED)
 *   • Filter changes (INV_ACTION_FILTER_ORG_CHANGED, INV_ACTION_FILTER_KIT_CHANGED)
 *   • Annotation placement / removal (SCAN_ACTION_ANNOTATION_ADDED / REMOVED)
 *
 * @example
 * trackUserAction({
 *   eventCategory: "user_action",
 *   eventName: TelemetryEventName.SCAN_ACTION_ITEM_CHECKED,
 *   app: "scan",
 *   caseId: "j573abc",
 *   manifestItemId: "item_01",
 *   templateItemId: "tpl_01",
 *   newStatus: "ok",
 *   previousStatus: "unchecked",
 *   itemIndex: 2,
 *   totalItems: 10,
 * });
 */
export function trackUserAction(input: UserActionInput): void {
  track(input as TelemetryTrackInput);
}

/**
 * Track an error event.
 *
 * Error events cover recoverable and unrecoverable failures:
 *   • QR scan failures (ERROR_QR_SCAN_FAILED)
 *   • Camera permission denial (ERROR_CAMERA_DENIED)
 *   • Photo upload failures (ERROR_PHOTO_UPLOAD_FAILED)
 *   • Convex query / mutation failures (ERROR_CONVEX_QUERY_FAILED)
 *   • FedEx validation failures (ERROR_FEDEX_VALIDATION_FAILED)
 *   • Unhandled exceptions (ERROR_UNHANDLED_EXCEPTION)
 *
 * @example
 * trackError({
 *   eventCategory: "error",
 *   eventName: TelemetryEventName.ERROR_CAMERA_DENIED,
 *   app: "scan",
 *   errorCode: "CAMERA_NOT_FOUND",
 *   errorMessage: "navigator.mediaDevices is not available",
 *   recoverable: false,
 *   permissionName: "camera",
 * });
 */
export function trackError(input: ErrorInput): void {
  track(input as TelemetryTrackInput);
}

/**
 * Track a performance event.
 *
 * Performance events cover timing measurements:
 *   • Map render time (PERF_MAP_RENDER)
 *   • Convex query response time (PERF_QUERY_RESPONSE)
 *   • Navigation timing (PERF_NAVIGATION_TIMING)
 *   • Real-time subscription latency (PERF_REALTIME_LATENCY)
 *   • Photo upload throughput (PERF_PHOTO_UPLOAD)
 *   • Map endpoint latency (PERF_MAP_ENDPOINT)
 *
 * @example
 * trackPerformance({
 *   eventCategory: "performance",
 *   eventName: TelemetryEventName.PERF_REALTIME_LATENCY,
 *   app: "scan",
 *   durationMs: 1250,
 *   withinTarget: true,
 *   triggerMutation: "scan:submitDamagePhoto",
 *   mutationSubmittedAt: Date.now() - 1250,
 *   subscriptionUpdatedAt: Date.now(),
 *   withinFidelityTarget: true,
 * });
 */
export function trackPerformance(input: PerformanceInput): void {
  track(input as TelemetryTrackInput);
}

// ─── Singleton client object ───────────────────────────────────────────────────

/**
 * Object-interface wrapper around the module-level singleton.
 *
 * Prefer the named function exports (`track`, `identify`, etc.) in new code.
 * This object is provided for call sites that prefer a dot-notation API or
 * need to pass the client as a dependency.
 *
 * @example
 * import { telemetryClient } from "@/lib/telemetry";
 *
 * telemetryClient.identify("kp_user123");
 * telemetryClient.trackNavigation({ ... });
 */
export const telemetryClient = {
  /** @see track */
  track,
  /** @see trackNavigation */
  trackNavigation,
  /** @see trackUserAction */
  trackUserAction,
  /** @see trackError */
  trackError,
  /** @see trackPerformance */
  trackPerformance,
  /** @see identify */
  identify,
  /** @see getSessionId */
  getSessionId,
  /** @see flush */
  flush,
  /** @see initTelemetry */
  initTelemetry,
  /** @see getQueue */
  getQueue,
} as const;

export type TelemetryClient = typeof telemetryClient;
