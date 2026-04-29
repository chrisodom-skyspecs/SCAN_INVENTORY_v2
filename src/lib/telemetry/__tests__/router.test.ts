// @vitest-environment jsdom

/**
 * Unit tests for lib/telemetry/router.ts
 *
 * Test strategy
 * ─────────────
 * • Override `mode` explicitly in RouterOptions to avoid NODE_ENV side effects.
 * • Use vi.fn() stubs for convexMutateAsync to avoid real Convex calls.
 * • Disable queue timer / lifecycle handlers (flushIntervalMs: 0,
 *   registerLifecycleHandlers: false) to keep tests isolated.
 *
 * Coverage areas
 * ──────────────
 * 1.  createNoopSink         — discards batch, resolves, never throws
 * 2.  createConsoleSink      — logs via groupCollapsed / console.log
 * 3.  createConvexSink       — calls mutateAsync with the event batch
 * 4.  createConvexSink       — propagates mutateAsync errors (queue retries)
 * 5.  resolveSink("noop")    — returns no-op sink
 * 6.  resolveSink("console") — returns console sink
 * 7.  resolveSink("endpoint") + convexMutateAsync — returns Convex sink
 * 8.  resolveSink("endpoint") missing convexMutateAsync — warns, falls back
 * 9.  resolveSink default    — reads NODE_ENV via resolveTransportMode
 * 10. createRoutedQueue      — wires sink + queue together
 * 11. createRoutedQueue      — passes queueOpts through to TelemetryQueue
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConsoleSink,
  createConvexSink,
  createNoopSink,
  createRoutedQueue,
  resolveSink,
  type ConvexMutateAsync,
} from "../router";
import { TelemetryQueue } from "../queue";
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

/** Stub for a Convex mutateAsync function. */
function makeConvexMutateAsync(
  impl?: (args: { events: unknown[] }) => Promise<{ accepted: number }>
): ConvexMutateAsync {
  return vi.fn(impl ?? (async () => ({ accepted: 1 })));
}

// ─── createNoopSink ───────────────────────────────────────────────────────────

describe("createNoopSink()", () => {
  it("resolves without calling any I/O", async () => {
    const sink = createNoopSink();
    await expect(sink([makeEvent()])).resolves.toBeUndefined();
  });

  it("resolves for an empty batch", async () => {
    const sink = createNoopSink();
    await expect(sink([])).resolves.toBeUndefined();
  });

  it("does not throw on repeated calls", async () => {
    const sink = createNoopSink();
    await sink([makeEvent()]);
    await sink([makeEvent()]);
    // No assertions needed — absence of throw is the expectation
  });

  it("returns a function (TelemetryQueueSendFn)", () => {
    const sink = createNoopSink();
    expect(typeof sink).toBe("function");
  });
});

// ─── createConsoleSink ────────────────────────────────────────────────────────

describe("createConsoleSink()", () => {
  beforeEach(() => {
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls console.groupCollapsed with a batch label", async () => {
    const sink = createConsoleSink();
    await sink([makeEvent()]);
    expect(console.groupCollapsed).toHaveBeenCalledOnce();
    const [label] = (console.groupCollapsed as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(label).toContain("[telemetry]");
  });

  it("includes the event count in the label (singular)", async () => {
    const sink = createConsoleSink();
    await sink([makeEvent()]);
    const [label] = (console.groupCollapsed as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(label).toContain("1 event");
    expect(label).not.toContain("1 events");
  });

  it("includes the event count in the label (plural)", async () => {
    const sink = createConsoleSink();
    await sink([makeEvent(), makeEvent(), makeEvent()]);
    const [label] = (console.groupCollapsed as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(label).toContain("3 events");
  });

  it("calls console.log once per event in the batch", async () => {
    const sink = createConsoleSink();
    await sink([makeEvent(), makeEvent()]);
    expect(console.log).toHaveBeenCalledTimes(2);
  });

  it("calls console.groupEnd after printing all events", async () => {
    const sink = createConsoleSink();
    await sink([makeEvent()]);
    expect(console.groupEnd).toHaveBeenCalledOnce();
  });

  it("falls back to console.log when groupCollapsed is unavailable", async () => {
    // Temporarily remove groupCollapsed to simulate the fallback path
    const origGroupCollapsed = console.groupCollapsed;
    const origGroupEnd = console.groupEnd;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).groupCollapsed = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).groupEnd = undefined;

    try {
      const sink = createConsoleSink();
      await sink([makeEvent()]);
      expect(console.log).toHaveBeenCalledOnce();
    } finally {
      // Restore
      console.groupCollapsed = origGroupCollapsed;
      console.groupEnd = origGroupEnd;
    }
  });

  it("resolves for an empty batch (no crash)", async () => {
    const sink = createConsoleSink();
    await expect(sink([])).resolves.toBeUndefined();
  });
});

// ─── createConvexSink ─────────────────────────────────────────────────────────

describe("createConvexSink()", () => {
  it("calls mutateAsync with the event batch", async () => {
    const mutateAsync = makeConvexMutateAsync();
    const sink = createConvexSink(mutateAsync);

    const events = [makeEvent(), makeEvent()];
    await sink(events);

    expect(mutateAsync).toHaveBeenCalledOnce();
    expect(mutateAsync).toHaveBeenCalledWith({ events });
  });

  it("resolves when mutateAsync resolves", async () => {
    const sink = createConvexSink(makeConvexMutateAsync());
    await expect(sink([makeEvent()])).resolves.toBeUndefined();
  });

  it("propagates rejection from mutateAsync (queue owns retry)", async () => {
    const mutateAsync = makeConvexMutateAsync(async () => {
      throw new Error("Convex unavailable");
    });
    const sink = createConvexSink(mutateAsync);

    // The sink should reject so the queue can retry
    await expect(sink([makeEvent()])).rejects.toThrow("Convex unavailable");
  });

  it("passes all events in the batch to mutateAsync", async () => {
    const received: unknown[] = [];
    const mutateAsync = makeConvexMutateAsync(async ({ events }) => {
      received.push(...events);
      return { accepted: events.length };
    });

    const events = [
      makeEvent({ toPath: "/a" } as Partial<TelemetryEvent>),
      makeEvent({ toPath: "/b" } as Partial<TelemetryEvent>),
      makeEvent({ toPath: "/c" } as Partial<TelemetryEvent>),
    ];

    const sink = createConvexSink(mutateAsync);
    await sink(events);

    expect(received).toHaveLength(3);
  });

  it("handles an empty batch without error", async () => {
    const mutateAsync = makeConvexMutateAsync();
    const sink = createConvexSink(mutateAsync);
    await expect(sink([])).resolves.toBeUndefined();
    expect(mutateAsync).toHaveBeenCalledWith({ events: [] });
  });
});

// ─── resolveSink — mode: "noop" ──────────────────────────────────────────────

describe('resolveSink({ mode: "noop" })', () => {
  it("returns a sink that resolves without side effects", async () => {
    const sink = resolveSink({ mode: "noop" });
    await expect(sink([makeEvent()])).resolves.toBeUndefined();
  });

  it("ignores convexMutateAsync when mode is noop", async () => {
    const mutateAsync = makeConvexMutateAsync();
    const sink = resolveSink({ mode: "noop", convexMutateAsync: mutateAsync });
    await sink([makeEvent()]);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

// ─── resolveSink — mode: "console" ───────────────────────────────────────────

describe('resolveSink({ mode: "console" })', () => {
  beforeEach(() => {
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a sink that logs to the console", async () => {
    const sink = resolveSink({ mode: "console" });
    await sink([makeEvent()]);
    expect(console.groupCollapsed).toHaveBeenCalledOnce();
  });

  it("ignores convexMutateAsync when mode is console", async () => {
    const mutateAsync = makeConvexMutateAsync();
    const sink = resolveSink({ mode: "console", convexMutateAsync: mutateAsync });
    await sink([makeEvent()]);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

// ─── resolveSink — mode: "endpoint" ──────────────────────────────────────────

describe('resolveSink({ mode: "endpoint" })', () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a Convex sink that calls mutateAsync", async () => {
    const mutateAsync = makeConvexMutateAsync();
    const sink = resolveSink({ mode: "endpoint", convexMutateAsync: mutateAsync });

    const events = [makeEvent()];
    await sink(events);

    expect(mutateAsync).toHaveBeenCalledOnce();
    expect(mutateAsync).toHaveBeenCalledWith({ events });
  });

  it("falls back to console sink when convexMutateAsync is absent", async () => {
    const sink = resolveSink({ mode: "endpoint" });
    await sink([makeEvent()]);
    // Console sink was used (groupCollapsed called)
    expect(console.groupCollapsed).toHaveBeenCalled();
  });

  it("emits a console.warn when convexMutateAsync is absent in endpoint mode", async () => {
    resolveSink({ mode: "endpoint" });
    expect(console.warn).toHaveBeenCalledOnce();
    const [msg] = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(msg).toContain("convexMutateAsync");
    expect(msg).toContain("endpoint");
  });

  it("does NOT warn when convexMutateAsync is provided", async () => {
    resolveSink({ mode: "endpoint", convexMutateAsync: makeConvexMutateAsync() });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("Convex sink propagates errors (for queue retry)", async () => {
    const mutateAsync = makeConvexMutateAsync(async () => {
      throw new Error("timeout");
    });
    const sink = resolveSink({ mode: "endpoint", convexMutateAsync: mutateAsync });
    await expect(sink([makeEvent()])).rejects.toThrow("timeout");
  });
});

// ─── resolveSink — NODE_ENV detection ────────────────────────────────────────

describe("resolveSink() — NODE_ENV-based default detection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses noop sink in test environment (NODE_ENV=test)", async () => {
    // NODE_ENV is already "test" in vitest — pass no mode override
    const sink = resolveSink();
    // The sink should be a no-op (no groupCollapsed call)
    const spy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    await sink([makeEvent()]);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── createRoutedQueue ────────────────────────────────────────────────────────

describe("createRoutedQueue()", () => {
  it("returns a TelemetryQueue instance", () => {
    const queue = createRoutedQueue(
      { mode: "noop" },
      { flushIntervalMs: 0, registerLifecycleHandlers: false }
    );
    expect(queue).toBeInstanceOf(TelemetryQueue);
    queue.destroy();
  });

  it("enqueues and flushes events through the selected sink (noop)", async () => {
    const queue = createRoutedQueue(
      { mode: "noop" },
      { flushIntervalMs: 0, registerLifecycleHandlers: false }
    );

    queue.enqueue(makeEvent());
    queue.enqueue(makeEvent());
    expect(queue.size()).toBe(2);

    await queue.flush();
    expect(queue.size()).toBe(0);
    queue.destroy();
  });

  it("wires the Convex sink in endpoint mode", async () => {
    const mutateAsync = makeConvexMutateAsync();
    const queue = createRoutedQueue(
      { mode: "endpoint", convexMutateAsync: mutateAsync },
      { flushIntervalMs: 0, registerLifecycleHandlers: false }
    );

    queue.enqueue(makeEvent());
    await queue.flush();

    expect(mutateAsync).toHaveBeenCalledOnce();
    queue.destroy();
  });

  it("passes queueOpts to TelemetryQueue (maxBatchSize)", async () => {
    const mutateAsync = makeConvexMutateAsync();
    const queue = createRoutedQueue(
      { mode: "endpoint", convexMutateAsync: mutateAsync },
      {
        maxBatchSize: 2,
        flushIntervalMs: 0,
        registerLifecycleHandlers: false,
      }
    );

    queue.enqueue(makeEvent());
    queue.enqueue(makeEvent()); // triggers auto-flush at threshold

    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    queue.destroy();
  });

  it("defaults to no routerOpts (noop in test environment)", () => {
    // NODE_ENV === "test" in vitest — calling createRoutedQueue() with no args
    // should not throw and should produce a valid queue
    const queue = createRoutedQueue(
      {},
      { flushIntervalMs: 0, registerLifecycleHandlers: false }
    );
    expect(queue).toBeInstanceOf(TelemetryQueue);
    queue.destroy();
  });

  it("can be used with console mode without errors", async () => {
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const queue = createRoutedQueue(
      { mode: "console" },
      { flushIntervalMs: 0, registerLifecycleHandlers: false }
    );

    queue.enqueue(makeEvent());
    await queue.flush();

    expect(console.groupCollapsed).toHaveBeenCalledOnce();
    queue.destroy();
    vi.restoreAllMocks();
  });
});
