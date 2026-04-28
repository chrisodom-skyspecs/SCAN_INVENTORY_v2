// @vitest-environment jsdom

/**
 * Unit tests for the telemetry transport layer.
 *
 * This module tests the transport-specific behaviour that is separate from the
 * core TelemetryClient tests in telemetry.lib.test.ts:
 *
 *   1. buildEndpointTransport — retry on retryable HTTP status codes
 *   2. buildEndpointTransport — retry on network errors (fetch rejection)
 *   3. buildEndpointTransport — no retry on non-retryable status codes
 *   4. buildEndpointTransport — respects maxAttempts ceiling
 *   5. buildEndpointTransport — exponential backoff delay (non-jitter)
 *   6. buildEndpointTransport — calls sleep between retries
 *   7. buildEndpointTransport — default maxAttempts=1 (backward compat)
 *   8. buildConvexTransport   — calls mutateAsync with event batch
 *   9. buildConvexTransport   — swallows mutateAsync errors
 *  10. computeRetryDelay      — exponential growth without jitter
 *  11. computeRetryDelay      — caps at maxDelayMs
 *  12. computeRetryDelay      — jitter produces values within ±25% range
 *  13. TelemetryClient (endpoint mode) — uses retry internally
 *  14. DEFAULT_RETRYABLE_STATUSES     — contains expected HTTP codes
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildConvexTransport,
  buildEndpointTransport,
  computeRetryDelay,
  createTelemetryClient,
  DEFAULT_RETRYABLE_STATUSES,
  type RetryOptions,
  type TelemetryTransport,
} from "../telemetry.lib";
import { TelemetryEventName } from "@/types/telemetry.types";
import type { TelemetryEvent } from "@/types/telemetry.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid telemetry event for transport tests. */
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
 * Create RetryOptions suitable for unit tests:
 * - sleep resolves instantly (no real delays)
 * - jitter disabled for deterministic assertions
 */
function testRetryOptions(
  overrides: Partial<RetryOptions> = {}
): RetryOptions {
  return {
    jitter: false,
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── computeRetryDelay ────────────────────────────────────────────────────────

describe("computeRetryDelay", () => {
  it("returns baseDelayMs for the first retry (retryNumber=1)", () => {
    const delay = computeRetryDelay(1, {
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitter: false,
    });
    expect(delay).toBe(1_000);
  });

  it("doubles the delay for the second retry (retryNumber=2)", () => {
    const delay = computeRetryDelay(2, {
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitter: false,
    });
    expect(delay).toBe(2_000);
  });

  it("applies exponential growth: base × 2^(n-1)", () => {
    const base = 500;
    const opts = { baseDelayMs: base, maxDelayMs: 100_000, jitter: false };
    expect(computeRetryDelay(1, opts)).toBe(500);   // 500 × 2^0
    expect(computeRetryDelay(2, opts)).toBe(1_000); // 500 × 2^1
    expect(computeRetryDelay(3, opts)).toBe(2_000); // 500 × 2^2
    expect(computeRetryDelay(4, opts)).toBe(4_000); // 500 × 2^3
  });

  it("caps the delay at maxDelayMs", () => {
    const delay = computeRetryDelay(10, {
      baseDelayMs: 1_000,
      maxDelayMs: 5_000,
      jitter: false,
    });
    expect(delay).toBe(5_000);
  });

  it("with jitter=true: result is within ±25% of the base exponential value", () => {
    const base = 1_000;
    const opts = { baseDelayMs: base, maxDelayMs: 30_000, jitter: true };

    // Run 50 trials — all should be within ±25% of the base exponential
    for (let i = 0; i < 50; i++) {
      const delay = computeRetryDelay(1, opts);
      expect(delay).toBeGreaterThanOrEqual(750);   // 1000 - 25%
      expect(delay).toBeLessThanOrEqual(1_250);    // 1000 + 25%
    }
  });

  it("with jitter=true: result is never negative", () => {
    const opts = { baseDelayMs: 1, maxDelayMs: 1, jitter: true };
    for (let i = 0; i < 50; i++) {
      expect(computeRetryDelay(1, opts)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── DEFAULT_RETRYABLE_STATUSES ───────────────────────────────────────────────

describe("DEFAULT_RETRYABLE_STATUSES", () => {
  it("includes 429 (Too Many Requests)", () => {
    expect(DEFAULT_RETRYABLE_STATUSES).toContain(429);
  });

  it("includes 500 (Internal Server Error)", () => {
    expect(DEFAULT_RETRYABLE_STATUSES).toContain(500);
  });

  it("includes 502 (Bad Gateway)", () => {
    expect(DEFAULT_RETRYABLE_STATUSES).toContain(502);
  });

  it("includes 503 (Service Unavailable)", () => {
    expect(DEFAULT_RETRYABLE_STATUSES).toContain(503);
  });

  it("includes 504 (Gateway Timeout)", () => {
    expect(DEFAULT_RETRYABLE_STATUSES).toContain(504);
  });

  it("does NOT include 400 (Bad Request — non-retryable)", () => {
    expect(DEFAULT_RETRYABLE_STATUSES).not.toContain(400);
  });

  it("does NOT include 401 (Unauthorized — non-retryable)", () => {
    expect(DEFAULT_RETRYABLE_STATUSES).not.toContain(401);
  });

  it("does NOT include 404 (Not Found — non-retryable)", () => {
    expect(DEFAULT_RETRYABLE_STATUSES).not.toContain(404);
  });
});

// ─── buildEndpointTransport — default (no retry) ─────────────────────────────

describe("buildEndpointTransport (default: 1 attempt)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves successfully on HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 })
    );

    const transport = buildEndpointTransport("/api/telemetry");
    await expect(transport.send([makeEvent()])).resolves.toBeUndefined();
  });

  it("does not retry by default (maxAttempts=1) on network errors", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry");
    await expect(transport.send([makeEvent()])).resolves.toBeUndefined();

    // Only one attempt — no retry
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry by default on retryable HTTP status (503)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry");
    await expect(transport.send([makeEvent()])).resolves.toBeUndefined();

    // Only one attempt — no retry with default options
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("swallows errors and resolves (telemetry must never throw)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("catastrophic failure"))
    );
    const transport = buildEndpointTransport("/api/telemetry");
    await expect(transport.send([])).resolves.toBeUndefined();
  });
});

// ─── buildEndpointTransport — retry on retryable status ──────────────────────

describe("buildEndpointTransport — retry on retryable HTTP status", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries on 503 and succeeds on the second attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 3,
      ...testRetryOptions({ sleep: sleepMock }),
    });

    await transport.send([makeEvent()]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledOnce();
  });

  it("retries on 429 (Too Many Requests)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 2,
      ...testRetryOptions(),
    });

    await transport.send([makeEvent()]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 500, 502, 504 as well", async () => {
    for (const status of [500, 502, 504]) {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status })
        .mockResolvedValueOnce({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);

      const transport = buildEndpointTransport("/api/telemetry", {
        maxAttempts: 2,
        ...testRetryOptions(),
      });

      await transport.send([makeEvent()]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it("does NOT retry on 400 (Bad Request)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400 });
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 3,
      ...testRetryOptions(),
    });

    await transport.send([makeEvent()]);
    expect(fetchMock).toHaveBeenCalledOnce(); // no retry
  });

  it("does NOT retry on 401 (Unauthorized)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 3,
      ...testRetryOptions(),
    });

    await transport.send([makeEvent()]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does NOT retry on 404 (Not Found)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 3,
      ...testRetryOptions(),
    });

    await transport.send([makeEvent()]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ─── buildEndpointTransport — retry on network error ─────────────────────────

describe("buildEndpointTransport — retry on network error", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries on fetch rejection (network offline)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 2,
      ...testRetryOptions({ sleep: sleepMock }),
    });

    await transport.send([makeEvent()]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledOnce();
  });

  it("exhausts all attempts and resolves silently when all fail", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 3,
      ...testRetryOptions(),
    });

    // Must not throw even after all retries fail
    await expect(transport.send([makeEvent()])).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("calls sleep between each retry", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 4,
      ...testRetryOptions({ sleep: sleepMock }),
    });

    await transport.send([makeEvent()]);

    // 4 attempts → 3 sleep calls (between each pair of attempts)
    expect(sleepMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT call sleep after the last failed attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 2,
      ...testRetryOptions({ sleep: sleepMock }),
    });

    await transport.send([makeEvent()]);

    // 2 attempts: sleep only between attempt 1 and 2 (once)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledOnce();
  });
});

// ─── buildEndpointTransport — maxAttempts enforcement ────────────────────────

describe("buildEndpointTransport — maxAttempts enforcement", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes exactly maxAttempts fetch calls when all fail", async () => {
    for (const maxAttempts of [1, 2, 3, 5]) {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new TypeError("offline"));
      vi.stubGlobal("fetch", fetchMock);

      const transport = buildEndpointTransport("/api/telemetry", {
        maxAttempts,
        ...testRetryOptions(),
      });

      await transport.send([makeEvent()]);
      expect(fetchMock).toHaveBeenCalledTimes(maxAttempts);
    }
  });

  it("stops retrying immediately on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValue({ ok: true, status: 200 }); // should not be reached
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 5,
      ...testRetryOptions(),
    });

    await transport.send([makeEvent()]);
    // Should stop after 2 calls (fail + success), not continue to 5
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─── buildEndpointTransport — delay computation ───────────────────────────────

describe("buildEndpointTransport — backoff delay calculation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes increasing delays to sleep (exponential backoff without jitter)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const sleepCalls: number[] = [];
    const sleepMock = vi.fn().mockImplementation((ms: number) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    });

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 4,
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitter: false,
      sleep: sleepMock,
    });

    await transport.send([makeEvent()]);

    // Expected delays: 1000ms (retry 1), 2000ms (retry 2), 4000ms (retry 3)
    expect(sleepCalls).toEqual([1_000, 2_000, 4_000]);
  });

  it("caps delays at maxDelayMs", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const sleepCalls: number[] = [];
    const sleepMock = vi.fn().mockImplementation((ms: number) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    });

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 5,
      baseDelayMs: 1_000,
      maxDelayMs: 3_000,
      jitter: false,
      sleep: sleepMock,
    });

    await transport.send([makeEvent()]);

    // Expected delays: 1000, 2000, 3000 (capped), 3000 (capped)
    expect(sleepCalls).toEqual([1_000, 2_000, 3_000, 3_000]);
  });
});

// ─── buildEndpointTransport — custom retryableStatuses ───────────────────────

describe("buildEndpointTransport — custom retryableStatuses", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only retries on the specified status codes", async () => {
    // Only 418 ("I'm a Teapot") is in the retryable set
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 }) // NOT in custom set → no retry
      .mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 3,
      retryableStatuses: [418],
      ...testRetryOptions(),
    });

    await transport.send([makeEvent()]);
    // 503 is not in [418] → no retry, only 1 call
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries on a custom status code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 418 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry", {
      maxAttempts: 3,
      retryableStatuses: [418],
      ...testRetryOptions(),
    });

    await transport.send([makeEvent()]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─── buildConvexTransport ─────────────────────────────────────────────────────

describe("buildConvexTransport", () => {
  it("calls mutateAsync with the event batch", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ accepted: 2 });

    const transport = buildConvexTransport(mutateAsync);
    const events = [makeEvent(), makeEvent()];

    await transport.send(events);

    expect(mutateAsync).toHaveBeenCalledOnce();
    expect(mutateAsync).toHaveBeenCalledWith({ events });
  });

  it("passes the full event array to mutateAsync", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ accepted: 3 });
    const transport = buildConvexTransport(mutateAsync);

    const events: TelemetryEvent[] = [
      makeEvent({ toPath: "/a" } as Partial<TelemetryEvent>),
      makeEvent({ toPath: "/b" } as Partial<TelemetryEvent>),
      makeEvent({ toPath: "/c" } as Partial<TelemetryEvent>),
    ];

    await transport.send(events);

    const [callArgs] = mutateAsync.mock.calls[0] as [{ events: TelemetryEvent[] }][];
    expect((callArgs as unknown as { events: TelemetryEvent[] }).events).toHaveLength(3);
  });

  it("resolves even when mutateAsync rejects (swallows errors)", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Convex mutation failed"));

    const transport = buildConvexTransport(mutateAsync);

    // Must not throw
    await expect(transport.send([makeEvent()])).resolves.toBeUndefined();
  });

  it("resolves when the batch is empty", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ accepted: 0 });
    const transport = buildConvexTransport(mutateAsync);

    await expect(transport.send([])).resolves.toBeUndefined();
    expect(mutateAsync).toHaveBeenCalledWith({ events: [] });
  });

  it("calls mutateAsync even for large batches", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ accepted: 20 });
    const transport = buildConvexTransport(mutateAsync);

    const events = Array.from({ length: 20 }, () => makeEvent());
    await transport.send(events);

    expect(mutateAsync).toHaveBeenCalledOnce();
  });
});

// ─── TelemetryClient (endpoint mode) — retry integration ─────────────────────

describe("TelemetryClient in endpoint mode — retry integration", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries failed batches up to 3 times by default", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const client = createTelemetryClient({
      mode: "endpoint",
      sessionId: "retry-test-session",
      retryOptions: {
        maxAttempts: 3,
        sleep: sleepMock,
        jitter: false,
      },
    });

    client.track({
      eventCategory: "navigation",
      eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
      app: "scan",
      toPath: "/scan",
      fromPath: null,
    });
    client.flush();

    // Wait for all async operations (3 fetch attempts + 2 sleeps)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the second attempt and stops retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const client = createTelemetryClient({
      mode: "endpoint",
      sessionId: "retry-success-session",
      retryOptions: {
        maxAttempts: 3,
        sleep: sleepMock,
        jitter: false,
      },
    });

    client.track({
      eventCategory: "navigation",
      eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
      app: "scan",
      toPath: "/scan",
      fromPath: null,
    });
    client.flush();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sleepMock).toHaveBeenCalledOnce();

    // Ensure no further retries happen after success
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
