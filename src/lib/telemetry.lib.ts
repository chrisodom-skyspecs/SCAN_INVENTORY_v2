/**
 * telemetry.lib.ts
 *
 * Provider-agnostic telemetry client for INVENTORY and SCAN apps.
 *
 * Features
 * ─────────
 * • track()      — emit any typed TelemetryEvent; auto-applies sessionId,
 *                  userId, and timestamp when omitted by the caller.
 * • identify()   — associate the current session with a Kinde user ID and
 *                  optional trait map.
 * • page()       — convenience wrapper that emits the correct navigation event
 *                  for the active app surface (INVENTORY or SCAN).
 *
 * Transport strategy (environment-aware)
 * ───────────────────────────────────────
 *   test:        no-op transport (HTTP requests are never made; events are
 *                still enqueued so test assertions can call drainQueue()).
 *   development: console transport (events are printed via console.groupCollapsed
 *                for real-time visibility in browser DevTools).
 *   production:  endpoint transport — events are batched and POSTed to
 *                NEXT_PUBLIC_TELEMETRY_ENDPOINT (or /api/telemetry by default).
 *
 * Batching (production only)
 * ──────────────────────────
 * Events are held in an in-memory queue and flushed:
 *   • when the queue reaches MAX_BATCH_SIZE (default 20 events)
 *   • every FLUSH_INTERVAL_MS (default 5 000 ms) via setInterval
 *   • on page visibility change to "hidden" (mobile backgrounding, tab switch)
 *   • on "beforeunload" (tab / window close)
 *
 * Session ID
 * ──────────
 * A UUID v4 is generated once per page load and stored under
 * "tlm_session_id" in sessionStorage.  Falls back to an in-memory UUID when
 * sessionStorage is unavailable (SSR, private-browsing mode).
 *
 * Usage
 * ─────
 *   import { telemetry } from "@/lib/telemetry.lib";
 *
 *   // Associate the signed-in user:
 *   telemetry.identify("kinde_user_abc");
 *
 *   // Record a page view:
 *   telemetry.page("inventory", "/inventory");
 *
 *   // Record a typed event (sessionId, userId, timestamp are auto-filled):
 *   telemetry.track({
 *     eventCategory: "navigation",
 *     eventName: TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED,
 *     app: "inventory",
 *     mapView: "M3",
 *     previousMapView: "M1",
 *   });
 *
 * Testing
 * ───────
 *   import { createTelemetryClient } from "@/lib/telemetry.lib";
 *
 *   const spy = vi.fn();
 *   const client = createTelemetryClient({
 *     sessionId: "test-session",
 *     transport: { send: spy },
 *   });
 *   client.track({ ... });
 *   client.flush();
 *   expect(spy).toHaveBeenCalledWith(expect.arrayContaining([...]));
 */

import type {
  DeviceContext,
  TelemetryApp,
  TelemetryEvent,
} from "@/types/telemetry.types";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SESSION_STORAGE_KEY = "tlm_session_id";

/** Maximum number of events to hold before an automatic flush. */
export const MAX_BATCH_SIZE = 20;

/** Interval (ms) between automatic flushes in production mode. */
export const FLUSH_INTERVAL_MS = 5_000;

/** Default telemetry ingestion endpoint. */
export const DEFAULT_TELEMETRY_ENDPOINT = "/api/telemetry";

// ─── Retry options ────────────────────────────────────────────────────────────

/**
 * Options that control how the endpoint transport retries failed deliveries.
 *
 * Retry strategy: exponential backoff with optional jitter.
 *
 *   delay(n) = min(baseDelayMs × 2^(n-1), maxDelayMs)  ± jitter
 *
 * where n is the 1-based retry attempt number (first retry = n=1).
 *
 * Telemetry delivery errors must never surface to calling code.  After
 * `maxAttempts` failed attempts the batch is silently discarded.
 *
 * @example
 * // Three attempts: immediate, 1 s, 2 s
 * const opts: RetryOptions = {
 *   maxAttempts: 3,
 *   baseDelayMs: 1_000,
 * };
 *
 * @example
 * // Unit-test friendly: replace sleep with instant resolution
 * const opts: RetryOptions = {
 *   maxAttempts: 3,
 *   sleep: (_ms) => Promise.resolve(),
 * };
 */
export interface RetryOptions {
  /**
   * Maximum number of delivery attempts (including the first).
   * Set to 1 to disable retries entirely.
   * @default 1  (for `buildEndpointTransport` — TelemetryClient uses 3)
   */
  maxAttempts?: number;

  /**
   * Base delay in ms between retry attempts.
   * The actual delay for attempt n is `min(baseDelayMs × 2^(n-1), maxDelayMs)`.
   * @default 1_000
   */
  baseDelayMs?: number;

  /**
   * Maximum delay cap in ms (prevents unbounded exponential growth).
   * @default 30_000
   */
  maxDelayMs?: number;

  /**
   * When true, adds ±25% uniform random jitter to each delay so retrying
   * clients don't all hit the endpoint at exactly the same time.
   * @default true
   */
  jitter?: boolean;

  /**
   * HTTP status codes that should trigger a retry.
   *
   * Non-retryable responses (e.g. 400 Bad Request) are discarded immediately
   * without further attempts, since retrying cannot fix a client-side error.
   *
   * @default [429, 500, 502, 503, 504]
   */
  retryableStatuses?: number[];

  /**
   * Async sleep function invoked between retry attempts.
   *
   * Replace with an instant-resolution function in unit tests to avoid
   * real timing delays:
   *   sleep: () => Promise.resolve()
   *
   * @default (ms) => new Promise((res) => setTimeout(res, ms))
   */
  sleep?: (ms: number) => Promise<void>;
}

/** HTTP status codes that should trigger a retry by default. */
export const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504] as const;

/**
 * Compute the delay in milliseconds before the nth retry attempt.
 *
 * @param retryNumber  1-based retry index (first retry = 1, second = 2, …).
 * @param opts         Resolved retry options.
 *
 * @example
 * computeRetryDelay(1, { baseDelayMs: 1000, maxDelayMs: 30000, jitter: false })
 * // → 1000  (base × 2^0 = 1000 × 1)
 * computeRetryDelay(2, { baseDelayMs: 1000, maxDelayMs: 30000, jitter: false })
 * // → 2000  (base × 2^1 = 1000 × 2)
 * computeRetryDelay(3, { baseDelayMs: 1000, maxDelayMs: 30000, jitter: false })
 * // → 4000  (base × 2^2 = 1000 × 4)
 */
export function computeRetryDelay(
  retryNumber: number,
  opts: Required<Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "jitter">>
): number {
  // Exponential backoff
  const exponential = opts.baseDelayMs * Math.pow(2, retryNumber - 1);
  const capped = Math.min(exponential, opts.maxDelayMs);

  if (!opts.jitter) return capped;

  // ±25% uniform jitter to prevent thundering-herd retries
  const jitterRange = capped * 0.25;
  const jitter = jitterRange * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

// ─── Environment detection ────────────────────────────────────────────────────

/** Transport behaviour dictated by the current environment. */
export type TransportMode = "noop" | "console" | "endpoint";

/** Derive the transport mode from `process.env.NODE_ENV`. */
export function resolveTransportMode(): TransportMode {
  // process.env.NODE_ENV is always statically replaced by Next.js / Vite
  if (process.env.NODE_ENV === "test") return "noop";
  if (process.env.NODE_ENV === "development") return "console";
  return "endpoint";
}

// ─── Session ID ───────────────────────────────────────────────────────────────

/**
 * Generate a UUID v4 string.
 *
 * Prefers `crypto.randomUUID()` (available in all modern browsers and
 * Node ≥ 14.17).  Falls back to a Math.random()-based polyfill for
 * environments where the Web Crypto API is absent (e.g. old jsdom).
 */
export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof (crypto as Crypto).randomUUID === "function"
  ) {
    return (crypto as Crypto).randomUUID();
  }
  // RFC 4122 v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Read or generate the session ID.
 *
 * Reads from sessionStorage when available; writes a freshly generated UUID
 * back when not present.  Returns a fresh UUID (not persisted) when
 * sessionStorage is inaccessible (SSR, private browsing, quota exceeded).
 */
export function getOrCreateSessionId(): string {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) return stored;
    const id = generateUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    // sessionStorage not available (SSR, private browsing, quota exceeded)
    return generateUUID();
  }
}

// ─── Device context ───────────────────────────────────────────────────────────

/**
 * Capture ambient device / browser metadata for event context enrichment.
 *
 * Reads browser globals (`navigator`, `screen`, `window`) safely so it
 * can be called at module load time without throwing in SSR or headless
 * test environments.
 *
 * Returns `undefined` when `window` is not defined (SSR / Node.js).
 *
 * @example
 * const device = getDeviceContext();
 * // In a browser: { userAgent: "Mozilla/...", language: "en-US", ... }
 * // In SSR/Node:  undefined
 */
export function getDeviceContext(): DeviceContext | undefined {
  // Guard against SSR and headless environments
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return undefined;
  }

  // NetworkInformation API — not universally available; use type-safe cast
  type NavigatorWithConnection = Navigator & {
    connection?: { effectiveType?: string };
  };
  const connection = (navigator as NavigatorWithConnection).connection;

  return {
    userAgent: (navigator.userAgent ?? "").slice(0, 512),
    language: navigator.language ?? "unknown",
    screenWidth: typeof screen !== "undefined" ? (screen.width ?? 0) : 0,
    screenHeight: typeof screen !== "undefined" ? (screen.height ?? 0) : 0,
    viewportWidth: window.innerWidth ?? 0,
    viewportHeight: window.innerHeight ?? 0,
    touchSupport: (navigator.maxTouchPoints ?? 0) > 0,
    connectionType: connection?.effectiveType ?? "unknown",
    devicePixelRatio: window.devicePixelRatio ?? 1,
  };
}

// ─── Transport interface ──────────────────────────────────────────────────────

/**
 * A transport is responsible for delivering a batch of events to their
 * destination.  Implementations must never throw — any errors should be
 * caught internally and handled silently.
 */
export interface TelemetryTransport {
  send(events: TelemetryEvent[]): Promise<void>;
}

// ─── Built-in transports ──────────────────────────────────────────────────────

/**
 * No-op transport — used in test environments so that HTTP requests are
 * never made during automated test runs.
 *
 * Even with this transport, `track()` still enqueues events; tests can
 * call `client.drainQueue()` to retrieve and assert on emitted events.
 */
export const noopTransport: TelemetryTransport = {
  async send(_events: TelemetryEvent[]): Promise<void> {
    // Intentionally empty — no requests in test environments.
  },
};

/**
 * Console transport — used in development environments.
 *
 * Each event is printed via `console.groupCollapsed` so it is visible
 * in browser DevTools but collapsed by default to reduce noise.
 * Falls back to `console.log` in environments that lack `groupCollapsed`
 * (e.g. Node.js test runners).
 */
export const consoleTransport: TelemetryTransport = {
  async send(events: TelemetryEvent[]): Promise<void> {
    for (const event of events) {
      const label = `[telemetry] ${event.eventCategory}:${event.eventName}`;
      if (
        typeof console.groupCollapsed === "function" &&
        typeof console.groupEnd === "function"
      ) {
        console.groupCollapsed(label);
        console.log(event);
        console.groupEnd();
      } else {
        console.log(label, event);
      }
    }
  },
};

/**
 * HTTP endpoint transport — used in production.
 *
 * Sends a JSON-encoded batch to the configured endpoint via `fetch` with
 * optional exponential-backoff retry on transient failures.
 *
 * The `keepalive: true` option allows the request to outlive the page on
 * `beforeunload`.  All network errors are swallowed after exhausting retries
 * so telemetry failures never affect the user experience.
 *
 * Retry behaviour
 * ───────────────
 * Controlled by the `retryOptions` parameter.
 *
 * When `retryOptions` is omitted, the transport makes exactly **one** attempt
 * (no retry) — preserving backward-compatible behaviour for code that
 * constructs transports directly.
 *
 * For production retry (up to 3 attempts), either:
 *   a) Pass `{ maxAttempts: 3 }` explicitly, or
 *   b) Use `TelemetryClient` in `"endpoint"` mode — it always sets 3 attempts.
 *
 * HTTP statuses that trigger a retry: 429, 500, 502, 503, 504.
 * Non-retryable statuses (e.g. 400) are discarded immediately.
 * Network-level errors (fetch rejection) always trigger a retry.
 *
 * @param endpoint     Full URL or path to the telemetry ingestion endpoint.
 * @param retryOptions Optional retry configuration (default: 1 attempt, no retry).
 */
export function buildEndpointTransport(
  endpoint: string,
  retryOptions?: RetryOptions
): TelemetryTransport {
  // Resolve options — default to single attempt (no retry) for backward compat.
  const maxAttempts = retryOptions?.maxAttempts ?? 1;
  const baseDelayMs = retryOptions?.baseDelayMs ?? 1_000;
  const maxDelayMs = retryOptions?.maxDelayMs ?? 30_000;
  const jitter = retryOptions?.jitter ?? true;
  const retryableStatuses =
    retryOptions?.retryableStatuses ?? [...DEFAULT_RETRYABLE_STATUSES];
  const sleep =
    retryOptions?.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    async send(events: TelemetryEvent[]): Promise<void> {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let shouldRetry = false;

        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events }),
            // keepalive allows the request to survive a beforeunload flush
            keepalive: true,
          });

          if (response.ok) {
            // Successful delivery — exit the retry loop.
            return;
          }

          // Non-ok HTTP response: retry only for retryable status codes.
          shouldRetry = retryableStatuses.includes(response.status);
        } catch {
          // Network-level error (offline, DNS failure, etc.) — always retry.
          shouldRetry = true;
        }

        // If the failure is non-retryable, or this was the last attempt,
        // give up silently — transport errors must never surface.
        if (!shouldRetry || attempt >= maxAttempts) {
          return;
        }

        // Wait before the next attempt with exponential backoff + optional jitter.
        const retryNumber = attempt; // 1 = first retry
        const delay = computeRetryDelay(retryNumber, {
          baseDelayMs,
          maxDelayMs,
          jitter,
        });
        await sleep(delay);
      }
    },
  };
}

// ─── Convex transport ─────────────────────────────────────────────────────────

/**
 * Build a transport that delivers telemetry events directly via a Convex
 * mutation — bypassing the /api/telemetry HTTP intermediary.
 *
 * This transport is intended for use inside React components that already have
 * access to the Convex client via `useMutation`.  Pass the bound mutation
 * function returned by `useMutation(api.telemetry.recordTelemetryBatch)` as
 * the `mutateAsync` parameter.
 *
 * The function signature is kept generic (`(args: { events: unknown[] }) =>
 * Promise<{ accepted: number }>`) so the transport can be constructed without
 * importing Convex-specific types into the core telemetry library.
 *
 * All Convex errors are caught and silently discarded — transport failures must
 * never propagate to callers.
 *
 * @example
 * // In a React component or custom hook:
 * const recordBatch = useMutation(api.telemetry.recordTelemetryBatch);
 * const client = createTelemetryClient({
 *   transport: buildConvexTransport(recordBatch),
 * });
 *
 * @param mutateAsync  The Convex mutation function to call for each batch.
 *                     Accepts `{ events: unknown[] }` and returns a Promise.
 */
export function buildConvexTransport(
  mutateAsync: (args: { events: unknown[] }) => Promise<{ accepted: number }>
): TelemetryTransport {
  return {
    async send(events: TelemetryEvent[]): Promise<void> {
      try {
        await mutateAsync({ events });
      } catch {
        // Transport errors must never surface to calling code.
      }
    },
  };
}

// ─── Identity state ───────────────────────────────────────────────────────────

export interface IdentityState {
  /** Kinde user ID of the currently authenticated user. */
  userId: string | undefined;
  /** Freeform trait map set by the last `identify()` call. */
  traits: Record<string, unknown>;
}

// ─── Track input type ─────────────────────────────────────────────────────────

/**
 * Distributive Omit — applies Omit to each member of a union independently.
 *
 * TypeScript's built-in `Omit<Union, Keys>` does NOT distribute over union
 * members; it produces the Omit of the intersection of all member keys,
 * which loses the discriminated-union narrowing.
 *
 * This conditional type distributes correctly:
 *   DistOmit<A | B, "x"> → Omit<A, "x"> | Omit<B, "x">
 */
type DistOmit<T, K extends string | number | symbol> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * The caller-facing input for `track()` and `trackEvent()`.
 *
 * The following fields are omitted from the event payload and auto-filled
 * by the client — callers only need to supply event-specific fields:
 *
 *   • `timestamp`  — `Date.now()` (can be overridden)
 *   • `sessionId`  — the client's session ID (can be overridden)
 *   • `userId`     — from the last `identify()` call (can be overridden)
 *   • `device`     — captured by `getDeviceContext()` at init (can be overridden)
 *
 * The distributive Omit ensures the discriminated-union narrowing is preserved:
 * passing `{ eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED, ... }` still
 * requires — and allows — all fields from `ScanActionQrScannedEvent`.
 */
export type TelemetryTrackInput = DistOmit<
  TelemetryEvent,
  "timestamp" | "sessionId" | "userId" | "device"
> & {
  /** Override the auto-generated timestamp (epoch ms). */
  timestamp?: number;
  /** Override the auto-assigned session ID. */
  sessionId?: string;
  /** Override the userId from the active identity (or omit for anonymous). */
  userId?: string;
  /**
   * Override the auto-captured device context.
   * Useful in tests that need a deterministic device profile.
   */
  device?: DeviceContext;
};

// ─── Client options ───────────────────────────────────────────────────────────

export interface TelemetryClientOptions {
  /**
   * Override the transport mode.
   * Defaults to `resolveTransportMode()` (NODE_ENV-based detection).
   */
  mode?: TransportMode;

  /**
   * Override the telemetry ingestion endpoint (endpoint mode only).
   * Defaults to `NEXT_PUBLIC_TELEMETRY_ENDPOINT` env var or
   * `DEFAULT_TELEMETRY_ENDPOINT` ("/api/telemetry").
   */
  endpoint?: string;

  /**
   * Pin the session ID to a specific value.
   * Useful in unit tests for deterministic assertions.
   */
  sessionId?: string;

  /**
   * Inject a custom transport implementation.
   * When provided, `mode` and `endpoint` are ignored for transport selection.
   * The resolved `mode` still controls flush-on-console behavior.
   */
  transport?: TelemetryTransport;

  /**
   * Override retry behaviour for the endpoint transport (endpoint mode only).
   *
   * When not provided, `TelemetryClient` defaults to 3 attempts with
   * exponential backoff (1 s base, 30 s max, ±25% jitter).
   *
   * In unit tests, inject `{ sleep: () => Promise.resolve() }` to avoid
   * real delays when testing retry logic.
   *
   * @example
   * // Fast-retry for testing:
   * const client = createTelemetryClient({
   *   mode: "endpoint",
   *   retryOptions: { maxAttempts: 3, sleep: () => Promise.resolve() },
   * });
   */
  retryOptions?: RetryOptions;

  /**
   * Inject a pre-built device context instead of calling `getDeviceContext()`.
   *
   * When provided, this value is used as the device context for all events
   * emitted by this client instance.  Useful in unit tests that need a
   * deterministic, environment-independent device profile.
   *
   * Set to `null` to explicitly disable device context enrichment.
   *
   * @example
   * // Unit test with a fixed device profile:
   * const client = createTelemetryClient({
   *   mode: "noop",
   *   deviceContext: {
   *     userAgent: "TestBot/1.0",
   *     language: "en-US",
   *     screenWidth: 390,
   *     screenHeight: 844,
   *     viewportWidth: 390,
   *     viewportHeight: 844,
   *     touchSupport: true,
   *     connectionType: "4g",
   *     devicePixelRatio: 3,
   *   },
   * });
   */
  deviceContext?: DeviceContext | null;
}

// ─── Telemetry client ─────────────────────────────────────────────────────────

/**
 * Core telemetry client.  Manages the event queue, identity state, session
 * ID, and transport lifecycle.
 *
 * Use the exported `telemetry` singleton for app code.
 * Use `createTelemetryClient()` in unit tests to inject mocks.
 */
export class TelemetryClient {
  readonly mode: TransportMode;
  private readonly transport: TelemetryTransport;
  private readonly _sessionId: string;
  private _identity: IdentityState = { userId: undefined, traits: {} };
  private _deviceContext: DeviceContext | undefined;
  private _queue: TelemetryEvent[] = [];
  private _flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TelemetryClientOptions = {}) {
    this.mode = options.mode ?? resolveTransportMode();

    // Session ID: explicit override → sessionStorage → fresh UUID
    this._sessionId =
      options.sessionId ??
      (typeof window !== "undefined" ? getOrCreateSessionId() : generateUUID());

    // Device context: explicit inject → auto-capture → undefined (SSR / null opt-out)
    if (options.deviceContext !== undefined) {
      // null means caller explicitly disabled device context enrichment
      this._deviceContext = options.deviceContext ?? undefined;
    } else {
      // Auto-capture from browser globals (undefined in SSR / headless)
      this._deviceContext = getDeviceContext();
    }

    // Transport: explicit override → mode-based selection
    if (options.transport) {
      this.transport = options.transport;
    } else if (this.mode === "noop") {
      this.transport = noopTransport;
    } else if (this.mode === "console") {
      this.transport = consoleTransport;
    } else {
      const endpoint =
        options.endpoint ??
        (typeof process !== "undefined"
          ? process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT
          : undefined) ??
        DEFAULT_TELEMETRY_ENDPOINT;
      // Production mode: use 3-attempt retry with exponential backoff.
      // The retry options can be overridden via TelemetryClientOptions.retryOptions.
      this.transport = buildEndpointTransport(endpoint, {
        maxAttempts: options.retryOptions?.maxAttempts ?? 3,
        baseDelayMs: options.retryOptions?.baseDelayMs ?? 1_000,
        maxDelayMs:  options.retryOptions?.maxDelayMs  ?? 30_000,
        jitter:      options.retryOptions?.jitter      ?? true,
        retryableStatuses:
          options.retryOptions?.retryableStatuses ?? [...DEFAULT_RETRYABLE_STATUSES],
        sleep: options.retryOptions?.sleep,
      });
    }

    // Register browser-lifecycle flush handlers in production
    if (this.mode === "endpoint" && typeof window !== "undefined") {
      this._startFlushTimer();
      this._registerUnloadHandlers();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** The ephemeral session identifier for this page load. */
  getSessionId(): string {
    return this._sessionId;
  }

  /** Current identity state (userId + traits). */
  getIdentity(): Readonly<IdentityState> {
    return this._identity;
  }

  /**
   * Return the device context currently attached to all emitted events.
   *
   * Returns `undefined` when device context was disabled (`deviceContext: null`
   * in options) or when the client was created in an SSR/headless environment.
   */
  getDeviceContext(): DeviceContext | undefined {
    return this._deviceContext;
  }

  /**
   * Replace the client's device context.
   *
   * Useful for updating viewport dimensions after a resize event, or for
   * injecting a test-controlled profile mid-test.
   *
   * Pass `undefined` to remove device context from all subsequent events.
   *
   * @param ctx  New device context, or `undefined` to disable enrichment.
   */
  setDeviceContext(ctx: DeviceContext | undefined): void {
    this._deviceContext = ctx;
  }

  /**
   * Associate the current session with a Kinde user ID.
   *
   * All subsequent `track()` calls will include this userId unless the caller
   * provides an explicit override in the event payload.
   *
   * @param userId  Kinde user ID string (e.g. "kp_abc123").
   * @param traits  Optional freeform trait map (not PII).
   */
  identify(userId: string, traits: Record<string, unknown> = {}): void {
    this._identity = { userId, traits };
  }

  /**
   * Record a page view / navigation for the given app surface.
   *
   * Emits:
   *   • INVENTORY → INV_NAV_PAGE_LOADED
   *   • SCAN      → SCAN_NAV_PAGE_CHANGED
   *
   * @param app      Which app surface is reporting the page view.
   * @param path     The current route path (e.g. "/scan/[caseId]/inspect").
   * @param fromPath Previous route path for SCAN navigation events (null on first load).
   * @param userId   Optional user ID override (defaults to identify() state).
   */
  page(
    app: TelemetryApp,
    path: string,
    fromPath: string | null = null,
    userId?: string
  ): void {
    const resolvedUserId = userId ?? this._identity.userId;

    if (app === "inventory") {
      this.track({
        eventCategory: "navigation",
        eventName: TelemetryEventName.INV_NAV_PAGE_LOADED,
        app: "inventory",
        userId: resolvedUserId,
        loadDurationMs: 0,
        hydratedFromUrl: path.includes("?"),
      });
    } else {
      this.track({
        eventCategory: "navigation",
        eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
        app: "scan",
        userId: resolvedUserId,
        toPath: path,
        fromPath,
      });
    }
  }

  /**
   * Enqueue a telemetry event.
   *
   * Fields that are automatically filled when omitted by the caller:
   *   • `timestamp`  — `Date.now()`
   *   • `sessionId`  — the client's session ID
   *   • `userId`     — the userId from the last `identify()` call
   *
   * In noop (test) mode the event is still enqueued so test code can call
   * `drainQueue()` to inspect what was tracked.
   *
   * In console (development) mode the queue is flushed immediately after
   * each event for real-time visibility.
   *
   * In endpoint (production) mode the queue is flushed automatically when
   * it reaches MAX_BATCH_SIZE, or by the periodic timer.
   */
  track(input: TelemetryTrackInput): void {
    const event = {
      ...input,
      timestamp: input.timestamp ?? Date.now(),
      sessionId: input.sessionId ?? this._sessionId,
      userId: input.userId ?? this._identity.userId,
      // Device context: caller override → client's captured context → absent
      device: input.device !== undefined ? input.device : this._deviceContext,
    } as unknown as TelemetryEvent;

    this._queue.push(event);

    if (this.mode === "noop") {
      // Keep in queue for test assertions; no transport call.
      return;
    }

    if (this.mode === "console") {
      // Flush immediately in dev mode for real-time visibility.
      this.flush();
      return;
    }

    // Production: batch flush when threshold is reached.
    if (this._queue.length >= MAX_BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * Immediately dispatch all queued events to the transport.
   *
   * Clears the queue before calling `transport.send()` so that events
   * received during an in-flight send are held for the next flush.
   * This method is safe to call at any time; it is a no-op when the
   * queue is empty.
   */
  flush(): void {
    if (this._queue.length === 0) return;
    const batch = this._queue.splice(0, this._queue.length);
    // Fire-and-forget: telemetry must never block the caller.
    void this.transport.send(batch);
  }

  /**
   * Remove and return all events currently in the queue.
   *
   * Intended for unit tests: call `drainQueue()` after a series of `track()`
   * calls to assert on the emitted events without triggering the transport.
   */
  drainQueue(): TelemetryEvent[] {
    return this._queue.splice(0, this._queue.length);
  }

  /**
   * Peek at the current queue without removing events.
   *
   * Returns a shallow copy so mutations do not affect the internal state.
   */
  peekQueue(): TelemetryEvent[] {
    return [...this._queue];
  }

  /**
   * Reset the client to its initial state.
   *
   * Clears the event queue, identity state, and (if running in production
   * mode) stops the flush timer.  Primarily useful between unit tests.
   */
  reset(): void {
    this._queue.length = 0;
    this._identity = { userId: undefined, traits: {} };
    this._stopFlushTimer();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _startFlushTimer(): void {
    this._flushTimer = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);

    // Allow the Node.js process to exit even if this timer is still active.
    if (
      this._flushTimer !== null &&
      typeof this._flushTimer === "object" &&
      "unref" in this._flushTimer &&
      typeof (this._flushTimer as { unref?: () => void }).unref === "function"
    ) {
      (this._flushTimer as { unref: () => void }).unref();
    }
  }

  private _stopFlushTimer(): void {
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
  }

  private _registerUnloadHandlers(): void {
    // Flush when the user closes the tab / navigates away.
    window.addEventListener("beforeunload", () => this.flush());

    // Flush when the app is backgrounded on mobile (iOS Safari, Android Chrome).
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") {
          this.flush();
        }
      },
      { passive: true }
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a new `TelemetryClient` with the given options.
 *
 * Prefer the exported `telemetry` singleton for application code.
 * Use this factory in unit tests to control session IDs, transport mocks,
 * and transport modes without side effects on the shared singleton.
 *
 * @example
 * const mockTransport = { send: vi.fn().mockResolvedValue(undefined) };
 * const client = createTelemetryClient({
 *   mode: "endpoint",
 *   sessionId: "test-session-id",
 *   transport: mockTransport,
 * });
 * client.track({ ... });
 * client.flush();
 * expect(mockTransport.send).toHaveBeenCalledOnce();
 */
export function createTelemetryClient(
  options: TelemetryClientOptions = {}
): TelemetryClient {
  return new TelemetryClient(options);
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * The shared telemetry client instance.
 *
 * Automatically configured based on `process.env.NODE_ENV`:
 *   • test         → noop transport
 *   • development  → console transport
 *   • production   → HTTP endpoint transport with batching
 *
 * Import this in application code:
 *
 *   import { telemetry } from "@/lib/telemetry.lib";
 */
export const telemetry = createTelemetryClient();

// ─── trackEvent convenience function ─────────────────────────────────────────

/**
 * Emit a single typed telemetry event via the shared `telemetry` singleton.
 *
 * This is a thin wrapper around `telemetry.track()`.  It exists so that
 * call sites can use a familiar function-call idiom without importing the
 * full client:
 *
 *   import { trackEvent } from "@/lib/telemetry.lib";
 *
 *   trackEvent({
 *     eventCategory: "user_action",
 *     eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
 *     app: "scan",
 *     success: true,
 *     scanDurationMs: 350,
 *     method: "camera",
 *   });
 *
 * Context enrichment (auto-filled when omitted):
 *   • `timestamp`  — `Date.now()`
 *   • `sessionId`  — per-page-load UUID persisted in sessionStorage
 *   • `userId`     — from the last `telemetry.identify()` call
 *   • `device`     — captured from browser globals at client init
 *
 * For multiple sequential events, prefer `telemetry.track()` directly to
 * avoid the function-call overhead on the hot path.
 *
 * @param input  Event payload (all auto-filled fields are optional).
 */
export function trackEvent(input: TelemetryTrackInput): void {
  telemetry.track(input);
}
