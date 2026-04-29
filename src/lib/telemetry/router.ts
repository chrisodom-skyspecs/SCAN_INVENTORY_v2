/**
 * lib/telemetry/router.ts
 *
 * Environment-based sink router for the INVENTORY and SCAN telemetry pipeline.
 *
 * Responsibilities
 * ────────────────
 * Read the current environment (via NODE_ENV / resolveTransportMode) and return
 * the appropriate TelemetryQueueSendFn to back a TelemetryQueue:
 *
 *   test        → no-op sink   (events silently discarded; queue is still
 *                                populated so tests can call drain())
 *   development → console sink (batches printed to DevTools, collapsed)
 *   production  → Convex sink  (batches delivered via a Convex mutation)
 *
 * Design rationale
 * ────────────────
 * The Convex mutation function (the value returned by
 * `useMutation(api.telemetry.recordTelemetryBatch)`) is bound to a specific
 * React + Convex component tree and cannot be imported statically.  Therefore
 * `createConvexSink` and `resolveSink` accept the mutation as an injected
 * parameter rather than importing Convex types directly.  This keeps the
 * router framework-agnostic and fully unit-testable with plain mocks.
 *
 * Sink vs. Transport
 * ──────────────────
 * • A `TelemetryTransport` (telemetry.lib.ts) swallows all errors — it is the
 *   "safe boundary" used by TelemetryClient.
 * • A `TelemetryQueueSendFn` (this module) is allowed to throw or reject.  The
 *   surrounding TelemetryQueue owns the retry loop, applies exponential backoff,
 *   and silently discards batches after exhausting all attempts.
 *
 * The Convex sink intentionally propagates errors so the queue can retry
 * transient Convex failures with the configured backoff strategy.
 *
 * Usage
 * ─────
 * @example
 * // In a React component / custom hook that has a ConvexProvider ancestor:
 * import { useMutation } from "convex/react";
 * import { api } from "@/convex/_generated/api";
 * import { resolveSink, createRoutedQueue } from "@/lib/telemetry/router";
 *
 * const recordBatch = useMutation(api.telemetry.recordTelemetryBatch);
 *
 * // Option A — obtain just the send function and wire your own TelemetryQueue:
 * const send = resolveSink({ convexMutateAsync: recordBatch });
 * const queue = new TelemetryQueue({ send, maxBatchSize: 20 });
 *
 * // Option B — get a fully wired TelemetryQueue in one call:
 * const queue = createRoutedQueue(
 *   { convexMutateAsync: recordBatch },
 *   { maxBatchSize: 20, flushIntervalMs: 5_000 },
 * );
 *
 * Testing
 * ───────
 * @example
 * // Force a specific sink in a unit test without touching NODE_ENV:
 * import { resolveSink } from "@/lib/telemetry/router";
 *
 * const sink = resolveSink({ mode: "noop" });
 * const queue = new TelemetryQueue({ send: sink, flushIntervalMs: 0 });
 * queue.enqueue(event);
 * const drained = queue.drain(); // inspect without sending
 */

import type { TelemetryEvent } from "@/types/telemetry.types";
import type { TelemetryQueueOptions, TelemetryQueueSendFn } from "@/lib/telemetry/queue";
import { TelemetryQueue } from "@/lib/telemetry/queue";
import { resolveTransportMode, type TransportMode } from "@/lib/telemetry.lib";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The Convex mutation function signature expected by the production sink.
 *
 * Matches the shape returned by:
 *   `useMutation(api.telemetry.recordTelemetryBatch)`
 *   `useMutation(api.telemetry.persistTelemetryEvents)`
 *
 * Kept generic (`unknown[]` payload) so this module does not need to import
 * Convex-generated types.
 */
export type ConvexMutateAsync = (
  args: { events: unknown[] }
) => Promise<{ accepted: number }>;

/**
 * Options accepted by `resolveSink` and `createRoutedQueue`.
 */
export interface RouterOptions {
  /**
   * The Convex mutation function used to deliver batches in production.
   *
   * Required when the resolved mode is "endpoint" (i.e. NODE_ENV === "production").
   * Ignored in "noop" (test) and "console" (development) modes — those sinks
   * are selected regardless of whether this value is provided.
   *
   * Obtain via `useMutation(api.telemetry.recordTelemetryBatch)` inside a React
   * component that has a ConvexProvider in its ancestor tree.
   */
  convexMutateAsync?: ConvexMutateAsync;

  /**
   * Explicit transport mode override.
   *
   * When provided, this value takes precedence over the NODE_ENV-based
   * detection performed by `resolveTransportMode()`.  Useful in unit tests
   * that need to exercise a specific sink behaviour without manipulating
   * NODE_ENV directly.
   *
   * @default derived from NODE_ENV via resolveTransportMode()
   *   "test"        → "noop"
   *   "development" → "console"
   *   "production"  → "endpoint"
   */
  mode?: TransportMode;
}

// ─── Sinks ────────────────────────────────────────────────────────────────────

/**
 * Create a no-op sink that silently discards all delivered batches.
 *
 * Used in `NODE_ENV === "test"` so automated test runs never produce console
 * noise or attempt any network / IPC calls.
 *
 * The TelemetryQueue still buffers events normally when backed by this sink;
 * call `queue.drain()` to retrieve them without triggering delivery.
 *
 * @returns A TelemetryQueueSendFn that resolves immediately with no side effects.
 *
 * @example
 * const send = createNoopSink();
 * const queue = new TelemetryQueue({ send, flushIntervalMs: 0 });
 * queue.enqueue(event);
 * await queue.flush(); // no-op
 * // queue is now empty — event was discarded
 */
export function createNoopSink(): TelemetryQueueSendFn {
  return async (_batch: TelemetryEvent[]): Promise<void> => {
    // Intentionally empty — telemetry is suppressed in test environments.
  };
}

/**
 * Create a console sink that prints batches to the browser DevTools console.
 *
 * Used in `NODE_ENV === "development"` for real-time event visibility.
 * Each batch is printed under a collapsed `console.groupCollapsed` block
 * so it is inspectable without creating noise in an active session.
 *
 * Falls back to a flat `console.log` call in environments that lack the
 * grouping API (e.g. Node.js test runners, some CI environments).
 *
 * This sink never throws.
 *
 * @returns A TelemetryQueueSendFn that logs the batch and resolves.
 *
 * @example
 * // DevTools output (collapsed):
 * // ▸ [telemetry] batch (3 events)
 * //     navigation:scan:nav:page_changed  { … }
 * //     navigation:scan:nav:page_changed  { … }
 * //     user_action:scan:action:qr_scanned { … }
 */
export function createConsoleSink(): TelemetryQueueSendFn {
  return async (batch: TelemetryEvent[]): Promise<void> => {
    const label = `[telemetry] batch (${batch.length} event${batch.length === 1 ? "" : "s"})`;

    if (
      typeof console.groupCollapsed === "function" &&
      typeof console.groupEnd === "function"
    ) {
      console.groupCollapsed(label);
      for (const event of batch) {
        console.log(`  ${event.eventCategory}:${event.eventName}`, event);
      }
      console.groupEnd();
    } else {
      console.log(label, batch);
    }
  };
}

/**
 * Create a Convex sink that delivers batches via a Convex mutation.
 *
 * Used in `NODE_ENV === "production"`.  The mutation function is injected by
 * the caller so this module remains Convex-client agnostic — it never imports
 * `convex/react` or generated API types.
 *
 * Unlike `TelemetryTransport.send` (which swallows errors), the returned
 * `TelemetryQueueSendFn` intentionally propagates rejections from
 * `mutateAsync`.  The surrounding `TelemetryQueue` owns the retry loop and
 * will apply exponential backoff before silently discarding the batch after
 * exhausting all attempts.
 *
 * @param mutateAsync  Convex mutation function (from useMutation).
 * @returns A TelemetryQueueSendFn that calls mutateAsync and may reject.
 *
 * @example
 * const recordBatch = useMutation(api.telemetry.recordTelemetryBatch);
 * const send = createConvexSink(recordBatch);
 * const queue = new TelemetryQueue({ send, retryOptions: { maxAttempts: 3 } });
 */
export function createConvexSink(mutateAsync: ConvexMutateAsync): TelemetryQueueSendFn {
  return async (batch: TelemetryEvent[]): Promise<void> => {
    // Let the rejection propagate — TelemetryQueue handles retry / discard.
    await mutateAsync({ events: batch });
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Return the appropriate `TelemetryQueueSendFn` for the current environment.
 *
 * Sink selection matrix
 * ─────────────────────
 *   Resolved mode  │ convexMutateAsync provided? │ Sink used
 *   ───────────────┼─────────────────────────────┼──────────────
 *   "noop"         │ any                         │ no-op
 *   "console"      │ any                         │ console
 *   "endpoint"     │ yes                         │ Convex
 *   "endpoint"     │ no  (misconfiguration)      │ console + warn
 *
 * In production, if `convexMutateAsync` is absent the router falls back to
 * the console sink and emits a `console.warn` so the misconfiguration is
 * immediately visible in Vercel function logs.
 *
 * @param opts  Routing options (see `RouterOptions`).
 * @returns     A `TelemetryQueueSendFn` ready to pass to `new TelemetryQueue({ send })`.
 *
 * @example
 * // Standard production wiring inside a React component:
 * const recordBatch = useMutation(api.telemetry.recordTelemetryBatch);
 * const send = resolveSink({ convexMutateAsync: recordBatch });
 * const queue = new TelemetryQueue({ send });
 *
 * @example
 * // Test — force a specific sink without touching NODE_ENV:
 * const send = resolveSink({ mode: "noop" });
 */
export function resolveSink(opts: RouterOptions = {}): TelemetryQueueSendFn {
  const mode: TransportMode = opts.mode ?? resolveTransportMode();

  // ── Test environment ────────────────────────────────────────────────────────
  if (mode === "noop") {
    return createNoopSink();
  }

  // ── Development environment ─────────────────────────────────────────────────
  if (mode === "console") {
    return createConsoleSink();
  }

  // ── Production environment ──────────────────────────────────────────────────
  // mode === "endpoint"

  if (!opts.convexMutateAsync) {
    // Misconfiguration guard: log a warning and fall back to the console sink
    // so events are still visible rather than silently dropped.
    //
    // This should never occur in a correctly wired production app — the caller
    // is responsible for passing the useMutation result before creating the queue.
    if (typeof console !== "undefined") {
      console.warn(
        "[telemetry/router] resolveSink called in production (endpoint) mode " +
          "without convexMutateAsync. Falling back to console sink. " +
          "Pass useMutation(api.telemetry.recordTelemetryBatch) as convexMutateAsync."
      );
    }
    return createConsoleSink();
  }

  return createConvexSink(opts.convexMutateAsync);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a `TelemetryQueue` wired to the environment-appropriate sink.
 *
 * Convenience factory that combines `resolveSink` with
 * `new TelemetryQueue({ send, ...queueOpts })`.  Use it in React components
 * or custom hooks that need a ready-to-use queue without manually composing
 * the pieces.
 *
 * The queue inherits all `TelemetryQueueOptions` defaults:
 *   maxBatchSize:    20 events
 *   flushIntervalMs: 5 000 ms
 *   retryOptions:    3 attempts, exponential backoff (1 s base, 30 s max, ±25% jitter)
 *
 * Pass `queueOpts` to override any of these.
 *
 * @param routerOpts  Sink routing options (see `RouterOptions`).
 * @param queueOpts   Additional queue options (all fields except `send`).
 * @returns           A configured `TelemetryQueue` instance.
 *
 * @example
 * // Full production wiring inside a React custom hook:
 * const recordBatch = useMutation(api.telemetry.recordTelemetryBatch);
 * const queue = createRoutedQueue(
 *   { convexMutateAsync: recordBatch },
 *   { maxBatchSize: 20, flushIntervalMs: 5_000 },
 * );
 *
 * @example
 * // Unit test with a no-op sink and timer disabled:
 * const queue = createRoutedQueue(
 *   { mode: "noop" },
 *   { flushIntervalMs: 0, registerLifecycleHandlers: false },
 * );
 */
export function createRoutedQueue(
  routerOpts: RouterOptions = {},
  queueOpts: Omit<TelemetryQueueOptions, "send"> = {}
): TelemetryQueue {
  const send = resolveSink(routerOpts);
  return new TelemetryQueue({ ...queueOpts, send });
}
