/**
 * lib/telemetry/queue.ts
 *
 * Client-side event queue with configurable batching and exponential-backoff
 * retry for the INVENTORY and SCAN telemetry pipeline.
 *
 * Responsibilities
 * ────────────────
 * • Buffer telemetry events in memory.
 * • Auto-flush when the queue reaches `maxBatchSize` (threshold flush).
 * • Periodically flush on a configurable `flushIntervalMs` timer.
 * • Retry failed sends with exponential backoff + optional jitter.
 * • Flush on browser lifecycle events (beforeunload, visibilitychange → hidden).
 *
 * Relationship to TelemetryClient
 * ────────────────────────────────
 * `TelemetryClient` (telemetry.lib.ts) is the high-level API: it enriches
 * events with session IDs, user identity, and device context before handing
 * them to a transport.  `TelemetryQueue` is the low-level mechanism beneath
 * any transport layer — it cares only about *when* to send, *how many* events
 * to include in a batch, and *what to do* on failure.
 *
 * The `send` callback accepted by `TelemetryQueue` differs from
 * `TelemetryTransport.send`:
 *
 *   • `TelemetryTransport.send` is expected to swallow all errors internally
 *     (it is a "safe" boundary — errors never propagate to callers).
 *   • The `send` callback here MAY reject.  The queue owns the retry loop
 *     and is responsible for the "swallow after maxAttempts" guarantee.
 *
 * Retry strategy
 * ──────────────
 *   delay(n) = min(baseDelayMs × 2^(n-1), maxDelayMs) ± jitter
 *
 * where n is the 1-based retry attempt (first retry = n=1).
 * After `maxAttempts` failed attempts the batch is silently discarded.
 *
 * Concurrency model
 * ──────────────────
 * Multiple concurrent flush calls are safe.  Each call drains the queue
 * atomically via `splice()` before sending; concurrent drains produce
 * independent batches that are each delivered to the `send` callback.
 * Events enqueued *during* a send (or its retry waits) are picked up by the
 * next threshold or timer flush.
 *
 * Usage
 * ─────
 * @example
 * import { TelemetryQueue } from "@/lib/telemetry/queue";
 *
 * const queue = new TelemetryQueue({
 *   send: async (batch) => {
 *     const res = await fetch("/api/telemetry", {
 *       method: "POST",
 *       headers: { "Content-Type": "application/json" },
 *       body: JSON.stringify({ events: batch }),
 *       keepalive: true,
 *     });
 *     if (!res.ok) throw new Error(`HTTP ${res.status}`);
 *   },
 *   maxBatchSize: 20,
 *   flushIntervalMs: 5_000,
 *   retryOptions: { maxAttempts: 3, baseDelayMs: 1_000 },
 * });
 *
 * // Enqueue events (auto-flushes at threshold)
 * queue.enqueue(event);
 *
 * // Manual flush (awaitable)
 * await queue.flush();
 *
 * // Teardown
 * queue.destroy();
 *
 * Testing
 * ───────
 * @example
 * const sent: TelemetryEvent[][] = [];
 * const queue = new TelemetryQueue({
 *   send: async (batch) => { sent.push(batch); },
 *   maxBatchSize: 5,
 *   flushIntervalMs: 0, // disable timer
 *   retryOptions: {
 *     maxAttempts: 2,
 *     sleep: () => Promise.resolve(), // instant retry
 *   },
 * });
 *
 * queue.enqueue(event);
 * await queue.flush();
 * expect(sent).toHaveLength(1);
 */

import type { TelemetryEvent } from "@/types/telemetry.types";
import {
  computeRetryDelay,
  MAX_BATCH_SIZE,
  FLUSH_INTERVAL_MS,
  type RetryOptions,
} from "@/lib/telemetry.lib";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default maximum number of retry attempts (including the first). */
export const QUEUE_DEFAULT_MAX_ATTEMPTS = 3;

/** Default base delay in ms between retry attempts. */
export const QUEUE_DEFAULT_BASE_DELAY_MS = 1_000;

/** Default maximum delay cap in ms (prevents unbounded exponential growth). */
export const QUEUE_DEFAULT_MAX_DELAY_MS = 30_000;

/** Default jitter setting — enabled to prevent thundering-herd retries. */
export const QUEUE_DEFAULT_JITTER = true;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Async function that delivers a batch of events to their destination.
 *
 * Unlike `TelemetryTransport.send`, this callback is allowed to reject —
 * `TelemetryQueue` owns the retry loop and will catch rejections, apply
 * backoff, and silently discard the batch after exhausting all attempts.
 *
 * @param batch  Non-empty array of events to deliver.
 */
export type TelemetryQueueSendFn = (batch: TelemetryEvent[]) => Promise<void>;

/**
 * Options for constructing a `TelemetryQueue`.
 */
export interface TelemetryQueueOptions {
  /**
   * Async function that delivers a batch of events.
   *
   * May throw or reject on failure — the queue will retry according to
   * `retryOptions`.  After exhausting all attempts the batch is silently
   * discarded so telemetry never affects the user experience.
   */
  send: TelemetryQueueSendFn;

  /**
   * Maximum number of events to buffer before triggering an automatic flush.
   *
   * When `enqueue()` pushes the queue to this threshold, a flush is started
   * immediately without waiting for the next timer tick.
   *
   * @default 20  (MAX_BATCH_SIZE from telemetry.lib)
   */
  maxBatchSize?: number;

  /**
   * Interval in milliseconds for the periodic background flush timer.
   *
   * Set to `0` to disable the timer entirely (useful in unit tests).
   *
   * @default 5000  (FLUSH_INTERVAL_MS from telemetry.lib)
   */
  flushIntervalMs?: number;

  /**
   * Retry configuration for failed `send()` calls.
   *
   * Defaults:
   *   maxAttempts: 3
   *   baseDelayMs: 1 000
   *   maxDelayMs:  30 000
   *   jitter:      true
   *   sleep:       real setTimeout
   *
   * Override `sleep` in unit tests to avoid real delays:
   *   `sleep: () => Promise.resolve()`
   */
  retryOptions?: RetryOptions;

  /**
   * Whether to register browser lifecycle event handlers that flush the
   * queue before the page unloads or is backgrounded.
   *
   * Handles:
   *   • `window.beforeunload` — tab / window close or navigation
   *   • `document.visibilitychange` (hidden) — mobile app backgrounding,
   *     tab switches
   *
   * @default `true` when `window` is defined (i.e., in a browser context).
   *          `false` in SSR / Node.js environments.
   */
  registerLifecycleHandlers?: boolean;
}

// ─── Resolved options (internal) ─────────────────────────────────────────────

interface ResolvedRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  sleep: (ms: number) => Promise<void>;
}

// ─── TelemetryQueue ───────────────────────────────────────────────────────────

/**
 * Client-side event buffer with configurable batch flushing and retry.
 *
 * See module-level JSDoc for full usage and design rationale.
 */
export class TelemetryQueue {
  // ── Private state ───────────────────────────────────────────────────────────

  private readonly _send: TelemetryQueueSendFn;
  private readonly _maxBatchSize: number;
  private readonly _retry: ResolvedRetryOptions;

  /** The in-memory event buffer. */
  private _queue: TelemetryEvent[] = [];

  /** Handle for the periodic flush timer (null when disabled). */
  private _flushTimer: ReturnType<typeof setInterval> | null = null;

  // ── Constructor ─────────────────────────────────────────────────────────────

  constructor(options: TelemetryQueueOptions) {
    this._send = options.send;
    this._maxBatchSize = options.maxBatchSize ?? MAX_BATCH_SIZE;

    // Resolve retry options with defaults
    const r = options.retryOptions ?? {};
    this._retry = {
      maxAttempts: r.maxAttempts ?? QUEUE_DEFAULT_MAX_ATTEMPTS,
      baseDelayMs: r.baseDelayMs ?? QUEUE_DEFAULT_BASE_DELAY_MS,
      maxDelayMs: r.maxDelayMs ?? QUEUE_DEFAULT_MAX_DELAY_MS,
      jitter: r.jitter ?? QUEUE_DEFAULT_JITTER,
      sleep:
        r.sleep ??
        ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    };

    // Periodic flush timer
    const interval = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    if (interval > 0) {
      this._startTimer(interval);
    }

    // Browser lifecycle handlers
    const registerHandlers =
      options.registerLifecycleHandlers ?? typeof window !== "undefined";
    if (registerHandlers && typeof window !== "undefined") {
      this._registerLifecycleHandlers();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Add a single event to the queue.
   *
   * If the queue reaches `maxBatchSize` after this call, an automatic
   * threshold flush is started asynchronously (fire-and-forget).
   */
  enqueue(event: TelemetryEvent): void {
    this._queue.push(event);
    if (this._queue.length >= this._maxBatchSize) {
      // Threshold reached — start async flush without blocking the caller.
      void this._flushWithRetry();
    }
  }

  /**
   * Drain the queue and deliver all buffered events.
   *
   * Returns a `Promise` that resolves after delivery succeeds or all retry
   * attempts are exhausted.  The promise never rejects — telemetry failures
   * must never surface to calling code.
   *
   * Safe to call concurrently.  Each concurrent call drains the queue
   * independently; a second call while a send is in progress will send any
   * events enqueued *after* the first call started its drain.
   */
  async flush(): Promise<void> {
    await this._flushWithRetry();
  }

  /**
   * Fire-and-forget variant of `flush()`.
   *
   * Useful in synchronous contexts where `await` is unavailable
   * (e.g. inside a `beforeunload` event handler).
   */
  flushSync(): void {
    void this._flushWithRetry();
  }

  /**
   * Return the number of events currently buffered in the queue.
   */
  size(): number {
    return this._queue.length;
  }

  /**
   * Return a shallow copy of the queued events without removing them.
   *
   * Useful for inspecting queue contents in tests or monitoring UI.
   * Mutations to the returned array do not affect the internal buffer.
   */
  peek(): TelemetryEvent[] {
    return [...this._queue];
  }

  /**
   * Remove and return all buffered events without sending them.
   *
   * Intended for unit tests: drain the queue after a series of `enqueue()`
   * calls to assert on the events without triggering the send callback.
   */
  drain(): TelemetryEvent[] {
    return this._queue.splice(0, this._queue.length);
  }

  /**
   * Stop the periodic flush timer and clear the event buffer.
   *
   * Call this when the queue is no longer needed (e.g. component unmount,
   * process shutdown).  Any unsent events are discarded.
   *
   * If you want to deliver all buffered events before shutting down, call
   * `await flush()` before `destroy()`.
   */
  destroy(): void {
    this._stopTimer();
    this._queue.length = 0;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Drain the queue and attempt delivery, retrying on failure.
   *
   * Implementation notes
   * ────────────────────
   * 1. Drains the queue atomically at the *start* of each top-level call.
   *    Events enqueued while a retry is waiting are not merged into the
   *    in-flight batch — they will be flushed by the next call.
   *
   * 2. Each retry attempt sleeps for an exponentially increasing delay
   *    (computed by `computeRetryDelay`) before calling `send` again.
   *
   * 3. After `maxAttempts` failures the batch is silently discarded.
   *    Telemetry delivery errors must never propagate or disrupt the app.
   */
  private async _flushWithRetry(): Promise<void> {
    if (this._queue.length === 0) return;

    // Atomic drain — events added after this point go into the next batch.
    const batch = this._queue.splice(0, this._queue.length);

    const { maxAttempts, baseDelayMs, maxDelayMs, jitter, sleep } = this._retry;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this._send(batch);
        // Delivery succeeded — exit the retry loop.
        return;
      } catch {
        // Delivery failed.
        if (attempt >= maxAttempts) {
          // Exhausted all attempts — discard the batch silently.
          return;
        }

        // Compute the backoff delay for this retry number and wait.
        const delay = computeRetryDelay(attempt, { baseDelayMs, maxDelayMs, jitter });
        await sleep(delay);
      }
    }
  }

  /**
   * Start the periodic background flush timer.
   *
   * The timer is unref'd in Node.js so it does not prevent the process from
   * exiting (relevant for SSR / server-side telemetry scenarios).
   */
  private _startTimer(intervalMs: number): void {
    this._flushTimer = setInterval(() => {
      void this._flushWithRetry();
    }, intervalMs);

    // Allow Node.js to exit even when this timer is still running.
    if (
      this._flushTimer !== null &&
      typeof this._flushTimer === "object" &&
      "unref" in this._flushTimer &&
      typeof (this._flushTimer as { unref?: () => void }).unref === "function"
    ) {
      (this._flushTimer as { unref: () => void }).unref();
    }
  }

  /** Stop and nullify the periodic flush timer. */
  private _stopTimer(): void {
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
  }

  /**
   * Register browser lifecycle event handlers.
   *
   * Handlers use `flushSync()` (fire-and-forget) because:
   * - `beforeunload` handlers must be synchronous (awaiting would not work).
   * - The `keepalive: true` fetch option allows the request to outlive the page.
   */
  private _registerLifecycleHandlers(): void {
    // Flush on tab / window close or navigation away.
    window.addEventListener("beforeunload", () => this.flushSync());

    // Flush when the app is backgrounded (iOS Safari, Android Chrome).
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") {
          this.flushSync();
        }
      },
      { passive: true }
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a `TelemetryQueue` backed by a plain HTTP fetch endpoint.
 *
 * The returned queue sends batches to `endpoint` via `POST` with
 * `Content-Type: application/json` and `keepalive: true`.  HTTP errors
 * (non-2xx responses) are thrown as `Error` objects so the queue's retry
 * logic can catch them.
 *
 * @param endpoint    Full URL or path to the telemetry ingestion endpoint.
 * @param queueOptions  Additional queue options (excluding `send`).
 *
 * @example
 * const queue = createHttpTelemetryQueue("/api/telemetry", {
 *   maxBatchSize: 20,
 *   retryOptions: { maxAttempts: 3 },
 * });
 */
export function createHttpTelemetryQueue(
  endpoint: string,
  queueOptions?: Omit<TelemetryQueueOptions, "send">
): TelemetryQueue {
  return new TelemetryQueue({
    ...queueOptions,
    send: async (batch: TelemetryEvent[]) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        // keepalive allows the request to outlive the page on beforeunload.
        keepalive: true,
      });

      if (!response.ok) {
        // Throw so the queue retry logic can catch and retry.
        throw new Error(
          `Telemetry endpoint returned HTTP ${response.status}: ${response.statusText}`
        );
      }
    },
  });
}
