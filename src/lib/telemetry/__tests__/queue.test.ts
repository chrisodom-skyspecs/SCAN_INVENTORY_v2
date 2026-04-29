// @vitest-environment jsdom

/**
 * Unit tests for TelemetryQueue (lib/telemetry/queue.ts)
 *
 * Test strategy
 * ─────────────
 * • Use vi.fn() mocks for the `send` callback to avoid real HTTP calls.
 * • Disable the flush timer (flushIntervalMs: 0) unless the test explicitly
 *   exercises timer behaviour.
 * • Disable lifecycle handlers (registerLifecycleHandlers: false) to keep
 *   tests isolated from browser event side effects.
 * • Override `sleep` with an instant-resolve function in retry tests to
 *   avoid real backoff delays.
 *
 * Coverage areas
 * ──────────────
 * 1.  enqueue()                 — adds events to the buffer
 * 2.  Auto-flush at threshold   — triggers when queue reaches maxBatchSize
 * 3.  flush()                   — drains queue and calls send
 * 4.  flushSync()               — fire-and-forget variant
 * 5.  size() / peek() / drain() — queue inspection helpers
 * 6.  destroy()                 — stops timer and clears buffer
 * 7.  Retry on failure          — exponential backoff, maxAttempts
 * 8.  No retry on success       — send called exactly once
 * 9.  Silent discard            — no throw after maxAttempts exceeded
 * 10. Concurrent flush safety   — two concurrent calls don't double-deliver
 * 11. Empty flush is a no-op    — send not called on empty queue
 * 12. Timer flush               — periodic flush via setInterval
 * 13. createHttpTelemetryQueue  — factory wires up fetch correctly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TelemetryQueue,
  createHttpTelemetryQueue,
  QUEUE_DEFAULT_MAX_ATTEMPTS,
  QUEUE_DEFAULT_BASE_DELAY_MS,
  QUEUE_DEFAULT_MAX_DELAY_MS,
  QUEUE_DEFAULT_JITTER,
  type TelemetryQueueOptions,
} from "../queue";
import { TelemetryEventName } from "@/types/telemetry.types";
import type { TelemetryEvent } from "@/types/telemetry.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal valid TelemetryEvent for testing. */
function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    eventCategory: "navigation",
    eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
    app: "scan",
    toPath: "/scan/test",
    fromPath: null,
    sessionId: "test-session",
    timestamp: 1_000_000,
    ...overrides,
  } as TelemetryEvent;
}

/**
 * Build options that disable the periodic timer and lifecycle handlers,
 * and inject a mock send function.
 */
function makeTestOptions(
  sendImpl?: (batch: TelemetryEvent[]) => Promise<void>,
  extra?: Partial<TelemetryQueueOptions>
): TelemetryQueueOptions {
  return {
    send: sendImpl ?? vi.fn().mockResolvedValue(undefined),
    flushIntervalMs: 0,           // disable periodic timer
    registerLifecycleHandlers: false, // no browser event side-effects
    ...extra,
  };
}

/** Instant-resolve sleep for retry tests (avoids real backoff delays). */
const instantSleep = (): Promise<void> => Promise.resolve();

// ─── Exported constants ───────────────────────────────────────────────────────

describe("exported constants", () => {
  it("QUEUE_DEFAULT_MAX_ATTEMPTS is 3", () => {
    expect(QUEUE_DEFAULT_MAX_ATTEMPTS).toBe(3);
  });

  it("QUEUE_DEFAULT_BASE_DELAY_MS is 1000", () => {
    expect(QUEUE_DEFAULT_BASE_DELAY_MS).toBe(1_000);
  });

  it("QUEUE_DEFAULT_MAX_DELAY_MS is 30000", () => {
    expect(QUEUE_DEFAULT_MAX_DELAY_MS).toBe(30_000);
  });

  it("QUEUE_DEFAULT_JITTER is true", () => {
    expect(QUEUE_DEFAULT_JITTER).toBe(true);
  });
});

// ─── enqueue() ────────────────────────────────────────────────────────────────

describe("enqueue()", () => {
  it("adds an event to the internal buffer", () => {
    const q = new TelemetryQueue(makeTestOptions());
    q.enqueue(makeEvent());
    expect(q.size()).toBe(1);
    q.destroy();
  });

  it("accumulates multiple events in order", () => {
    const q = new TelemetryQueue(makeTestOptions());
    const e1 = makeEvent({ toPath: "/first" } as Partial<TelemetryEvent>);
    const e2 = makeEvent({ toPath: "/second" } as Partial<TelemetryEvent>);
    const e3 = makeEvent({ toPath: "/third" } as Partial<TelemetryEvent>);
    q.enqueue(e1);
    q.enqueue(e2);
    q.enqueue(e3);
    expect(q.peek()).toEqual([e1, e2, e3]);
    q.destroy();
  });

  it("does not flush below maxBatchSize", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send, { maxBatchSize: 5 }));

    for (let i = 0; i < 4; i++) q.enqueue(makeEvent());

    // Give async operations a chance to run
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    expect(q.size()).toBe(4);
    q.destroy();
  });
});

// ─── Auto-flush at threshold ──────────────────────────────────────────────────

describe("auto-flush at maxBatchSize threshold", () => {
  it("triggers a flush when queue reaches maxBatchSize", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send, { maxBatchSize: 3 }));

    q.enqueue(makeEvent());
    q.enqueue(makeEvent());
    q.enqueue(makeEvent()); // threshold reached

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    q.destroy();
  });

  it("sends exactly maxBatchSize events in the auto-flush batch", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send, { maxBatchSize: 3 }));

    for (let i = 0; i < 3; i++) q.enqueue(makeEvent());

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const [batch] = send.mock.calls[0] as [TelemetryEvent[]];
    expect(batch).toHaveLength(3);
    q.destroy();
  });

  it("drains queue to zero after auto-flush", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send, { maxBatchSize: 2 }));

    q.enqueue(makeEvent());
    q.enqueue(makeEvent());

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(q.size()).toBe(0);
    q.destroy();
  });

  it("triggers multiple auto-flushes for large volumes", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send, { maxBatchSize: 5 }));

    // Enqueue 10 events — two batches of 5
    for (let i = 0; i < 10; i++) q.enqueue(makeEvent());

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    q.destroy();
  });
});

// ─── flush() ──────────────────────────────────────────────────────────────────

describe("flush()", () => {
  it("delivers all buffered events to send", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send));

    q.enqueue(makeEvent({ toPath: "/a" } as Partial<TelemetryEvent>));
    q.enqueue(makeEvent({ toPath: "/b" } as Partial<TelemetryEvent>));
    await q.flush();

    expect(send).toHaveBeenCalledOnce();
    const [batch] = send.mock.calls[0] as [TelemetryEvent[]];
    expect(batch).toHaveLength(2);
    q.destroy();
  });

  it("clears the queue after a successful flush", async () => {
    const q = new TelemetryQueue(makeTestOptions());
    q.enqueue(makeEvent());
    await q.flush();
    expect(q.size()).toBe(0);
    q.destroy();
  });

  it("is a no-op when the queue is empty", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send));
    await q.flush();
    expect(send).not.toHaveBeenCalled();
    q.destroy();
  });

  it("returns a Promise (awaitable)", async () => {
    const q = new TelemetryQueue(makeTestOptions());
    q.enqueue(makeEvent());
    // flush() must return a Promise — if it throws synchronously the test fails
    const result = q.flush();
    expect(result).toBeInstanceOf(Promise);
    await result;
    q.destroy();
  });

  it("preserves event content through the send callback", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send));

    const event = makeEvent({ toPath: "/specific-path" } as Partial<TelemetryEvent>);
    q.enqueue(event);
    await q.flush();

    const [batch] = send.mock.calls[0] as [TelemetryEvent[]];
    expect(batch[0]).toMatchObject({ toPath: "/specific-path" });
    q.destroy();
  });
});

// ─── flushSync() ─────────────────────────────────────────────────────────────

describe("flushSync()", () => {
  it("triggers send without awaiting", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send));

    q.enqueue(makeEvent());
    q.flushSync(); // fire-and-forget

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    q.destroy();
  });

  it("returns void (not a Promise)", () => {
    const q = new TelemetryQueue(makeTestOptions());
    q.enqueue(makeEvent());
    const result = q.flushSync();
    expect(result).toBeUndefined();
    q.destroy();
  });
});

// ─── size() / peek() / drain() ───────────────────────────────────────────────

describe("size()", () => {
  it("returns 0 for a new empty queue", () => {
    const q = new TelemetryQueue(makeTestOptions());
    expect(q.size()).toBe(0);
    q.destroy();
  });

  it("returns the number of enqueued events", () => {
    const q = new TelemetryQueue(makeTestOptions());
    q.enqueue(makeEvent());
    q.enqueue(makeEvent());
    expect(q.size()).toBe(2);
    q.destroy();
  });
});

describe("peek()", () => {
  it("returns a copy of queued events without removing them", () => {
    const q = new TelemetryQueue(makeTestOptions());
    const event = makeEvent();
    q.enqueue(event);

    const peeked = q.peek();
    expect(peeked).toHaveLength(1);
    expect(q.size()).toBe(1); // still in queue
    q.destroy();
  });

  it("returns an independent copy — mutations do not affect the buffer", () => {
    const q = new TelemetryQueue(makeTestOptions());
    q.enqueue(makeEvent());

    const peeked = q.peek();
    peeked.pop(); // mutate the returned array

    expect(q.size()).toBe(1); // buffer unaffected
    q.destroy();
  });

  it("returns an empty array when the queue is empty", () => {
    const q = new TelemetryQueue(makeTestOptions());
    expect(q.peek()).toEqual([]);
    q.destroy();
  });
});

describe("drain()", () => {
  it("removes and returns all queued events", () => {
    const q = new TelemetryQueue(makeTestOptions());
    q.enqueue(makeEvent());
    q.enqueue(makeEvent());

    const drained = q.drain();
    expect(drained).toHaveLength(2);
    expect(q.size()).toBe(0);
    q.destroy();
  });

  it("returns an empty array when the queue is already empty", () => {
    const q = new TelemetryQueue(makeTestOptions());
    expect(q.drain()).toEqual([]);
    q.destroy();
  });

  it("does not call send when draining", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send));
    q.enqueue(makeEvent());
    q.drain();
    expect(send).not.toHaveBeenCalled();
    q.destroy();
  });
});

// ─── destroy() ────────────────────────────────────────────────────────────────

describe("destroy()", () => {
  it("clears the event buffer", () => {
    const q = new TelemetryQueue(makeTestOptions());
    q.enqueue(makeEvent());
    q.enqueue(makeEvent());
    q.destroy();
    expect(q.size()).toBe(0);
  });

  it("stops the periodic flush timer", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send, { flushIntervalMs: 1_000 }));

    q.enqueue(makeEvent());
    q.destroy(); // stop timer before it fires

    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ─── Retry on failure ─────────────────────────────────────────────────────────

describe("retry on failure", () => {
  it("retries when send rejects", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(undefined);

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: {
          maxAttempts: 3,
          sleep: instantSleep,
          jitter: false,
        },
      })
    );

    q.enqueue(makeEvent());
    await q.flush();

    expect(send).toHaveBeenCalledTimes(2);
    q.destroy();
  });

  it("calls sleep between retry attempts", async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(undefined);

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: {
          maxAttempts: 3,
          sleep: sleepMock,
          jitter: false,
        },
      })
    );

    q.enqueue(makeEvent());
    await q.flush();

    // 3 attempts: sleep called between attempt 1→2 and 2→3 (twice)
    expect(sleepMock).toHaveBeenCalledTimes(2);
    q.destroy();
  });

  it("succeeds on the second attempt and stops retrying", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(undefined); // should not be reached

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: { maxAttempts: 5, sleep: instantSleep, jitter: false },
      })
    );

    q.enqueue(makeEvent());
    await q.flush();

    expect(send).toHaveBeenCalledTimes(2);
    q.destroy();
  });

  it("makes exactly maxAttempts total calls when all fail", async () => {
    const send = vi.fn().mockRejectedValue(new Error("always fails"));

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: { maxAttempts: 4, sleep: instantSleep, jitter: false },
      })
    );

    q.enqueue(makeEvent());
    await q.flush();

    expect(send).toHaveBeenCalledTimes(4);
    q.destroy();
  });

  it("does not call sleep after the last failed attempt", async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue(new Error("all fail"));

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: {
          maxAttempts: 3,
          sleep: sleepMock,
          jitter: false,
        },
      })
    );

    q.enqueue(makeEvent());
    await q.flush();

    // 3 attempts → sleep called between 1→2 and 2→3 (twice, NOT after attempt 3)
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
    q.destroy();
  });

  it("silently discards the batch after exhausting maxAttempts (does not throw)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("permanent failure"));

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: { maxAttempts: 2, sleep: instantSleep, jitter: false },
      })
    );

    q.enqueue(makeEvent());
    // flush() must resolve, not reject, even after all retries fail
    await expect(q.flush()).resolves.toBeUndefined();
    q.destroy();
  });

  it("passes the same batch to all retry attempts", async () => {
    const receivedBatches: TelemetryEvent[][] = [];
    const send = vi
      .fn()
      .mockImplementation(async (batch: TelemetryEvent[]) => {
        receivedBatches.push([...batch]);
        throw new Error("fail");
      });

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: { maxAttempts: 3, sleep: instantSleep, jitter: false },
      })
    );

    const event = makeEvent({ toPath: "/retry-check" } as Partial<TelemetryEvent>);
    q.enqueue(event);
    await q.flush();

    // All three attempts receive the same batch
    expect(receivedBatches).toHaveLength(3);
    for (const batch of receivedBatches) {
      expect(batch[0]).toMatchObject({ toPath: "/retry-check" });
    }
    q.destroy();
  });

  it("applies exponential backoff delays without jitter", async () => {
    const delays: number[] = [];
    const sleepMock = vi.fn().mockImplementation(async (ms: number) => {
      delays.push(ms);
    });
    const send = vi.fn().mockRejectedValue(new Error("fail"));

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: {
          maxAttempts: 4,
          baseDelayMs: 500,
          maxDelayMs: 10_000,
          jitter: false,
          sleep: sleepMock,
        },
      })
    );

    q.enqueue(makeEvent());
    await q.flush();

    // Delays: 500ms (retry 1), 1000ms (retry 2), 2000ms (retry 3)
    expect(delays).toEqual([500, 1_000, 2_000]);
    q.destroy();
  });

  it("caps retry delays at maxDelayMs", async () => {
    const delays: number[] = [];
    const sleepMock = vi.fn().mockImplementation(async (ms: number) => {
      delays.push(ms);
    });
    const send = vi.fn().mockRejectedValue(new Error("fail"));

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: {
          maxAttempts: 5,
          baseDelayMs: 1_000,
          maxDelayMs: 2_500,
          jitter: false,
          sleep: sleepMock,
        },
      })
    );

    q.enqueue(makeEvent());
    await q.flush();

    // Expected: 1000, 2000, 2500 (capped), 2500 (capped)
    expect(delays).toEqual([1_000, 2_000, 2_500, 2_500]);
    q.destroy();
  });
});

// ─── No retry on success ──────────────────────────────────────────────────────

describe("no retry on success", () => {
  it("calls send exactly once when delivery succeeds on the first attempt", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    const q = new TelemetryQueue(
      makeTestOptions(send, {
        retryOptions: { maxAttempts: 3, sleep: instantSleep },
      })
    );

    q.enqueue(makeEvent());
    q.enqueue(makeEvent());
    await q.flush();

    expect(send).toHaveBeenCalledOnce();
    q.destroy();
  });
});

// ─── Concurrent flush safety ──────────────────────────────────────────────────

describe("concurrent flush safety", () => {
  it("two concurrent flush() calls do not double-deliver the same event", async () => {
    const delivered: TelemetryEvent[][] = [];
    const send = vi.fn().mockImplementation(async (batch: TelemetryEvent[]) => {
      delivered.push([...batch]);
    });

    const q = new TelemetryQueue(makeTestOptions(send));
    q.enqueue(makeEvent({ toPath: "/only-once" } as Partial<TelemetryEvent>));

    // Start two concurrent flushes
    const [p1, p2] = [q.flush(), q.flush()];
    await Promise.all([p1, p2]);

    // One of the flushes drained the queue, the other found it empty
    const totalEvents = delivered.flat();
    expect(
      totalEvents.filter(
        (e) => "toPath" in e && (e as { toPath?: string }).toPath === "/only-once"
      )
    ).toHaveLength(1);
    q.destroy();
  });
});

// ─── Empty flush is a no-op ───────────────────────────────────────────────────

describe("empty queue behaviour", () => {
  it("flush() does not call send when queue is empty", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send));
    await q.flush();
    expect(send).not.toHaveBeenCalled();
    q.destroy();
  });

  it("flushSync() does not call send when queue is empty", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send));
    q.flushSync();
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    q.destroy();
  });
});

// ─── Periodic timer flush ─────────────────────────────────────────────────────

describe("periodic timer flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes automatically on the configured interval", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(
      makeTestOptions(send, {
        flushIntervalMs: 2_000,
        registerLifecycleHandlers: false,
      })
    );

    q.enqueue(makeEvent());
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(send).toHaveBeenCalledOnce();

    q.destroy();
  });

  it("periodic flush is a no-op when queue is empty", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(
      makeTestOptions(send, { flushIntervalMs: 1_000 })
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).not.toHaveBeenCalled();

    q.destroy();
  });

  it("flushes multiple times over multiple intervals", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(
      makeTestOptions(send, { flushIntervalMs: 1_000 })
    );

    q.enqueue(makeEvent());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);

    q.enqueue(makeEvent());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(2);

    q.destroy();
  });

  it("timer is stopped after destroy()", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(
      makeTestOptions(send, { flushIntervalMs: 1_000 })
    );

    q.enqueue(makeEvent());
    q.destroy();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("timer is not started when flushIntervalMs is 0", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new TelemetryQueue(makeTestOptions(send, { flushIntervalMs: 0 }));

    q.enqueue(makeEvent());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();

    q.destroy();
  });
});

// ─── createHttpTelemetryQueue factory ────────────────────────────────────────

describe("createHttpTelemetryQueue()", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs events as JSON to the configured endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const q = createHttpTelemetryQueue("/api/telemetry", {
      flushIntervalMs: 0,
      registerLifecycleHandlers: false,
      retryOptions: { maxAttempts: 1, sleep: instantSleep },
    });

    const event = makeEvent();
    q.enqueue(event);
    await q.flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/telemetry");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ events: [event] });
    expect(init.keepalive).toBe(true);
    q.destroy();
  });

  it("throws when the response is not ok (enabling queue retry)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const q = createHttpTelemetryQueue("/api/telemetry", {
      flushIntervalMs: 0,
      registerLifecycleHandlers: false,
      retryOptions: {
        maxAttempts: 2,
        sleep: instantSleep,
        jitter: false,
      },
    });

    q.enqueue(makeEvent());
    await q.flush();

    // 503 caused a retry — two total fetch calls
    expect(fetchMock).toHaveBeenCalledTimes(2);
    q.destroy();
  });

  it("returns a TelemetryQueue instance", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const q = createHttpTelemetryQueue("/api/telemetry");
    expect(q).toBeInstanceOf(TelemetryQueue);
    q.destroy();
  });
});
