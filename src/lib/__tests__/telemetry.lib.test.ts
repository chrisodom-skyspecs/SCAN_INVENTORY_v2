// @vitest-environment jsdom

/**
 * Unit tests for the shared telemetry library.
 *
 * Test strategy
 * ─────────────
 * • All tests use `createTelemetryClient()` with explicit options so the
 *   test suite is isolated from the module-level `telemetry` singleton and
 *   the NODE_ENV-based transport detection.
 * • Transport behaviour is verified by injecting a `vi.fn()` mock that
 *   satisfies the `TelemetryTransport` interface.
 * • The `drainQueue()` helper is used in noop-mode tests to inspect the
 *   events that were enqueued without triggering any transport.
 *
 * Coverage areas
 * ──────────────
 * 1.  generateUUID()          — UUID v4 format and uniqueness
 * 2.  getOrCreateSessionId()  — sessionStorage read/write/fallback
 * 3.  resolveTransportMode()  — NODE_ENV → mode mapping
 * 4.  noopTransport           — never calls fetch
 * 5.  consoleTransport        — calls console.groupCollapsed per event
 * 6.  buildEndpointTransport  — POSTs to endpoint via fetch; swallows errors
 * 7.  TelemetryClient.track() — auto-fills timestamp, sessionId, userId;
 *                               enqueues in all modes
 * 8.  TelemetryClient.identify() — updates identity; applied to next track()
 * 9.  TelemetryClient.page()  — emits correct navigation events per app
 * 10. TelemetryClient.flush() — drains queue; calls transport.send
 * 11. TelemetryClient.drainQueue() — removes and returns events
 * 12. TelemetryClient.peekQueue()  — returns copy without removing
 * 13. TelemetryClient.reset()      — clears queue and identity
 * 14. Batching                     — auto-flush at MAX_BATCH_SIZE
 * 15. Console mode                 — immediate flush per event
 * 16. Noop mode                    — transport.send never called
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEndpointTransport,
  consoleTransport,
  createTelemetryClient,
  DEFAULT_TELEMETRY_ENDPOINT,
  generateUUID,
  getDeviceContext,
  getOrCreateSessionId,
  MAX_BATCH_SIZE,
  noopTransport,
  resolveTransportMode,
  SESSION_STORAGE_KEY,
  TelemetryClient,
  trackEvent,
  type TelemetryClientOptions,
  type TelemetryTrackInput,
  type TelemetryTransport,
} from "../telemetry.lib";
import { TelemetryEventName } from "@/types/telemetry.types";
import type { DeviceContext, TelemetryEvent } from "@/types/telemetry.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid track() input for a SCAN navigation event.
 * Uses Record<string, unknown> for overrides to keep the helper simple;
 * the cast at the end ensures the return type is TelemetryTrackInput.
 */
function makeNavEvent(overrides: Record<string, unknown> = {}): TelemetryTrackInput {
  return {
    eventCategory: "navigation",
    eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
    app: "scan",
    toPath: "/scan/case123",
    fromPath: null,
    ...overrides,
  } as TelemetryTrackInput;
}

/** Build a minimal valid track() input for a SCAN user_action event. */
function makeActionEvent(): TelemetryTrackInput {
  return {
    eventCategory: "user_action",
    eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
    app: "scan",
    success: true,
    scanDurationMs: 450,
    qrPayload: "case:abc123",
    method: "camera",
  } as TelemetryTrackInput;
}

/**
 * Create a mock transport with a vitest spy on `send`.
 * Returns { transport, send } — pass `transport` to createTelemetryClient
 * and assert on `send` (the spy).
 */
/** A mock transport that is itself a TelemetryTransport so it can be passed directly to options. */
type MockTransport = TelemetryTransport & { send: ReturnType<typeof vi.fn> };

function makeMockTransport(): MockTransport {
  const send = vi.fn().mockResolvedValue(undefined);
  // Cast send to the TelemetryTransport.send signature so the transport is
  // assignable to TelemetryClientOptions["transport"].
  return { send: send as unknown as TelemetryTransport["send"] } as MockTransport;
}

/** Convenience: create a client in noop mode with a fixed session ID. */
function makeNoopClient(extra: Partial<TelemetryClientOptions> = {}): TelemetryClient {
  return createTelemetryClient({
    mode: "noop",
    sessionId: "test-session-001",
    ...extra,
  });
}

// ─── generateUUID ─────────────────────────────────────────────────────────────

describe("generateUUID", () => {
  it("returns a string matching UUID v4 format", () => {
    const id = generateUUID();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("returns a different value on each call", () => {
    const ids = new Set(Array.from({ length: 20 }, generateUUID));
    expect(ids.size).toBe(20);
  });
});

// ─── getOrCreateSessionId ─────────────────────────────────────────────────────

describe("getOrCreateSessionId", () => {
  beforeEach(() => {
    // Start with a clean sessionStorage for each test.
    sessionStorage.clear();
  });

  it("creates and persists a new session ID when none exists", () => {
    const id = getOrCreateSessionId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(id);
  });

  it("returns the existing session ID when already persisted", () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, "existing-session-id");
    const id = getOrCreateSessionId();
    expect(id).toBe("existing-session-id");
  });

  it("returns consistent IDs across multiple calls in the same session", () => {
    const id1 = getOrCreateSessionId();
    const id2 = getOrCreateSessionId();
    expect(id1).toBe(id2);
  });
});

// ─── resolveTransportMode ─────────────────────────────────────────────────────

describe("resolveTransportMode", () => {
  it("returns 'noop' for test environment (current NODE_ENV)", () => {
    // In vitest, NODE_ENV is always 'test'
    expect(resolveTransportMode()).toBe("noop");
  });
});

// ─── noopTransport ────────────────────────────────────────────────────────────

describe("noopTransport", () => {
  it("resolves without calling fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    await noopTransport.send([]);
    await noopTransport.send([
      {
        eventCategory: "navigation",
        eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
        app: "scan",
        toPath: "/test",
        fromPath: null,
        sessionId: "s1",
        timestamp: Date.now(),
      } as TelemetryEvent,
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ─── consoleTransport ─────────────────────────────────────────────────────────

describe("consoleTransport", () => {
  it("calls console.groupCollapsed for each event", async () => {
    const groupCollapsed = vi
      .spyOn(console, "groupCollapsed")
      .mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const groupEnd = vi
      .spyOn(console, "groupEnd")
      .mockImplementation(() => undefined);

    const event = {
      eventCategory: "navigation",
      eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
      app: "scan",
      toPath: "/test",
      fromPath: null,
      sessionId: "s1",
      timestamp: 1000,
    } as TelemetryEvent;

    await consoleTransport.send([event, event]);

    expect(groupCollapsed).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(groupEnd).toHaveBeenCalledTimes(2);

    groupCollapsed.mockRestore();
    log.mockRestore();
    groupEnd.mockRestore();
  });

  it("labels the group with eventCategory:eventName", async () => {
    const groupCollapsed = vi
      .spyOn(console, "groupCollapsed")
      .mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "groupEnd").mockImplementation(() => undefined);

    await consoleTransport.send([
      {
        eventCategory: "user_action",
        eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
        app: "scan",
        success: true,
        scanDurationMs: null,
        method: "camera",
        sessionId: "s",
        timestamp: 1,
      } as TelemetryEvent,
    ]);

    expect(groupCollapsed).toHaveBeenCalledWith(
      "[telemetry] user_action:scan:action:qr_scanned"
    );

    vi.restoreAllMocks();
  });
});

// ─── buildEndpointTransport ───────────────────────────────────────────────────

describe("buildEndpointTransport", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs events as JSON to the configured endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("/api/telemetry");
    const events: TelemetryEvent[] = [
      {
        eventCategory: "navigation",
        eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
        app: "scan",
        toPath: "/scan",
        fromPath: null,
        sessionId: "s",
        timestamp: 1000,
      } as TelemetryEvent,
    ];

    await transport.send(events);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/telemetry");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ events });
    expect(init.keepalive).toBe(true);
  });

  it("swallows network errors without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    const transport = buildEndpointTransport("/api/telemetry");
    // Must not throw
    await expect(transport.send([])).resolves.toBeUndefined();
  });

  it("sends to the custom endpoint URL provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const transport = buildEndpointTransport("https://analytics.example.com/v1/batch");
    await transport.send([]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://analytics.example.com/v1/batch",
      expect.any(Object)
    );
  });
});

// ─── TelemetryClient — track() ────────────────────────────────────────────────

describe("TelemetryClient.track()", () => {
  it("auto-fills timestamp when omitted", () => {
    const before = Date.now();
    const client = makeNoopClient();
    client.track(makeNavEvent());
    const after = Date.now();

    const [event] = client.drainQueue();
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
  });

  it("uses caller-supplied timestamp when provided", () => {
    const client = makeNoopClient();
    client.track(makeNavEvent({ timestamp: 999_999 }));
    const [event] = client.drainQueue();
    expect(event.timestamp).toBe(999_999);
  });

  it("auto-fills sessionId from client when omitted", () => {
    const client = makeNoopClient({ sessionId: "pinned-session" });
    client.track(makeNavEvent());
    const [event] = client.drainQueue();
    expect(event.sessionId).toBe("pinned-session");
  });

  it("uses caller-supplied sessionId when provided", () => {
    const client = makeNoopClient({ sessionId: "default-session" });
    client.track(makeNavEvent({ sessionId: "override-session" }));
    const [event] = client.drainQueue();
    expect(event.sessionId).toBe("override-session");
  });

  it("auto-fills userId from identity when omitted", () => {
    const client = makeNoopClient();
    client.identify("kinde_user_xyz");
    client.track(makeNavEvent());
    const [event] = client.drainQueue();
    expect(event.userId).toBe("kinde_user_xyz");
  });

  it("uses caller-supplied userId when provided (overrides identity)", () => {
    const client = makeNoopClient();
    client.identify("kinde_user_xyz");
    client.track(makeNavEvent({ userId: "override_user" }));
    const [event] = client.drainQueue();
    expect(event.userId).toBe("override_user");
  });

  it("leaves userId undefined when no identity is set and none supplied", () => {
    const client = makeNoopClient();
    client.track(makeNavEvent());
    const [event] = client.drainQueue();
    expect(event.userId).toBeUndefined();
  });

  it("preserves all caller-supplied event-specific fields", () => {
    const client = makeNoopClient();
    client.track({
      eventCategory: "user_action",
      eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
      app: "scan",
      success: false,
      scanDurationMs: null,
      method: "manual_entry",
    });
    const [event] = client.drainQueue();
    expect(event).toMatchObject({
      eventCategory: "user_action",
      eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
      app: "scan",
      success: false,
      scanDurationMs: null,
      method: "manual_entry",
    });
  });

  it("enqueues multiple events in order", () => {
    const client = makeNoopClient();
    client.track(makeNavEvent({ toPath: "/first" }));
    client.track(makeNavEvent({ toPath: "/second" }));
    client.track(makeNavEvent({ toPath: "/third" }));

    const events = client.drainQueue();
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ toPath: "/first" });
    expect(events[1]).toMatchObject({ toPath: "/second" });
    expect(events[2]).toMatchObject({ toPath: "/third" });
  });
});

// ─── TelemetryClient — identify() ────────────────────────────────────────────

describe("TelemetryClient.identify()", () => {
  it("sets userId in identity state", () => {
    const client = makeNoopClient();
    client.identify("user_abc");
    expect(client.getIdentity().userId).toBe("user_abc");
  });

  it("sets traits in identity state", () => {
    const client = makeNoopClient();
    client.identify("user_abc", { role: "pilot", org: "SkySpecs" });
    expect(client.getIdentity().traits).toEqual({ role: "pilot", org: "SkySpecs" });
  });

  it("defaults traits to an empty object when not supplied", () => {
    const client = makeNoopClient();
    client.identify("user_abc");
    expect(client.getIdentity().traits).toEqual({});
  });

  it("overwrites the previous identity on repeated calls", () => {
    const client = makeNoopClient();
    client.identify("user_1");
    client.identify("user_2", { role: "admin" });
    expect(client.getIdentity().userId).toBe("user_2");
    expect(client.getIdentity().traits.role).toBe("admin");
  });

  it("the returned identity object is immutable (a snapshot)", () => {
    const client = makeNoopClient();
    client.identify("user_1");
    const identity1 = client.getIdentity();
    client.identify("user_2");
    // identity1 should still reflect user_1
    expect(identity1.userId).toBe("user_1");
    expect(client.getIdentity().userId).toBe("user_2");
  });
});

// ─── TelemetryClient — page() ─────────────────────────────────────────────────

describe("TelemetryClient.page()", () => {
  it("emits SCAN_NAV_PAGE_CHANGED for the scan app", () => {
    const client = makeNoopClient();
    client.page("scan", "/scan/case123/inspect", "/scan/case123");
    const [event] = client.drainQueue();
    expect(event.eventName).toBe(TelemetryEventName.SCAN_NAV_PAGE_CHANGED);
    expect(event.eventCategory).toBe("navigation");
    expect(event.app).toBe("scan");
    expect(event).toMatchObject({ toPath: "/scan/case123/inspect", fromPath: "/scan/case123" });
  });

  it("emits INV_NAV_PAGE_LOADED for the inventory app", () => {
    const client = makeNoopClient();
    client.page("inventory", "/inventory");
    const [event] = client.drainQueue();
    expect(event.eventName).toBe(TelemetryEventName.INV_NAV_PAGE_LOADED);
    expect(event.eventCategory).toBe("navigation");
    expect(event.app).toBe("inventory");
  });

  it("sets fromPath to null for scan when not provided", () => {
    const client = makeNoopClient();
    client.page("scan", "/scan");
    const [event] = client.drainQueue();
    expect(event).toMatchObject({ fromPath: null });
  });

  it("uses the identity userId when none is supplied explicitly", () => {
    const client = makeNoopClient();
    client.identify("kinde_page_user");
    client.page("scan", "/scan");
    const [event] = client.drainQueue();
    expect(event.userId).toBe("kinde_page_user");
  });

  it("uses the explicit userId over the identity userId", () => {
    const client = makeNoopClient();
    client.identify("identity_user");
    client.page("scan", "/scan", null, "explicit_user");
    const [event] = client.drainQueue();
    expect(event.userId).toBe("explicit_user");
  });

  it("sets hydratedFromUrl=true when the inventory path contains a query string", () => {
    const client = makeNoopClient();
    client.page("inventory", "/inventory?view=M3&case=abc");
    const [event] = client.drainQueue();
    expect(event).toMatchObject({ hydratedFromUrl: true });
  });

  it("sets hydratedFromUrl=false when the inventory path has no query string", () => {
    const client = makeNoopClient();
    client.page("inventory", "/inventory");
    const [event] = client.drainQueue();
    expect(event).toMatchObject({ hydratedFromUrl: false });
  });
});

// ─── TelemetryClient — flush() ────────────────────────────────────────────────

describe("TelemetryClient.flush()", () => {
  it("calls transport.send with the queued events", async () => {
    const mockTransport = makeMockTransport();
    const client = createTelemetryClient({
      mode: "endpoint",
      sessionId: "s1",
      transport: mockTransport,
    });

    client.track(makeNavEvent({ toPath: "/a" }));
    client.track(makeNavEvent({ toPath: "/b" }));
    client.flush();

    // Allow the microtask queue to drain
    await vi.waitFor(() => expect(mockTransport.send).toHaveBeenCalledOnce());

    const [[batch]] = mockTransport.send.mock.calls as [[TelemetryEvent[]]];
    expect(batch).toHaveLength(2);
  });

  it("clears the queue after flushing", async () => {
    const mockTransport = makeMockTransport();
    const client = createTelemetryClient({
      mode: "endpoint",
      sessionId: "s1",
      transport: mockTransport,
    });

    client.track(makeNavEvent());
    client.flush();

    await vi.waitFor(() => expect(mockTransport.send).toHaveBeenCalledOnce());
    expect(client.peekQueue()).toHaveLength(0);
  });

  it("is a no-op when the queue is empty", () => {
    const mockTransport = makeMockTransport();
    const client = createTelemetryClient({
      mode: "endpoint",
      sessionId: "s1",
      transport: mockTransport,
    });

    client.flush();
    expect(mockTransport.send).not.toHaveBeenCalled();
  });

  it("does not auto-flush in noop mode (track never triggers transport)", () => {
    const mockTransport = makeMockTransport();
    const client = createTelemetryClient({
      mode: "noop",
      sessionId: "s1",
      transport: mockTransport,
    });

    // Even well past MAX_BATCH_SIZE, track() never auto-flushes in noop mode.
    for (let i = 0; i < MAX_BATCH_SIZE + 5; i++) {
      client.track(makeNavEvent());
    }
    expect(mockTransport.send).not.toHaveBeenCalled();
    client.reset();
  });
});

// ─── TelemetryClient — drainQueue() / peekQueue() ────────────────────────────

describe("TelemetryClient.drainQueue()", () => {
  it("returns all queued events and empties the queue", () => {
    const client = makeNoopClient();
    client.track(makeNavEvent({ toPath: "/x" }));
    client.track(makeNavEvent({ toPath: "/y" }));

    const drained = client.drainQueue();
    expect(drained).toHaveLength(2);
    expect(client.peekQueue()).toHaveLength(0);
  });

  it("returns an empty array when the queue is empty", () => {
    const client = makeNoopClient();
    expect(client.drainQueue()).toEqual([]);
  });
});

describe("TelemetryClient.peekQueue()", () => {
  it("returns a copy of the queue without removing items", () => {
    const client = makeNoopClient();
    client.track(makeNavEvent());
    const peeked = client.peekQueue();
    expect(peeked).toHaveLength(1);
    // Queue is still intact
    expect(client.drainQueue()).toHaveLength(1);
  });

  it("returned array is a copy — mutations do not affect the queue", () => {
    const client = makeNoopClient();
    client.track(makeNavEvent());
    const peeked = client.peekQueue();
    peeked.pop(); // mutate the returned copy
    expect(client.peekQueue()).toHaveLength(1); // original unaffected
  });
});

// ─── TelemetryClient — reset() ───────────────────────────────────────────────

describe("TelemetryClient.reset()", () => {
  it("clears the event queue", () => {
    const client = makeNoopClient();
    client.track(makeNavEvent());
    client.reset();
    expect(client.peekQueue()).toHaveLength(0);
  });

  it("clears the identity state", () => {
    const client = makeNoopClient();
    client.identify("user_123", { role: "admin" });
    client.reset();
    expect(client.getIdentity().userId).toBeUndefined();
    expect(client.getIdentity().traits).toEqual({});
  });

  it("does not affect the session ID", () => {
    const client = makeNoopClient({ sessionId: "fixed-session" });
    client.reset();
    expect(client.getSessionId()).toBe("fixed-session");
  });
});

// ─── Batching ─────────────────────────────────────────────────────────────────

describe("batching", () => {
  it(`auto-flushes when MAX_BATCH_SIZE (${MAX_BATCH_SIZE}) events are queued`, async () => {
    const mockTransport = makeMockTransport();
    const client = createTelemetryClient({
      mode: "endpoint",
      sessionId: "batch-session",
      transport: mockTransport,
    });

    // Queue MAX_BATCH_SIZE - 1 events → no flush yet
    for (let i = 0; i < MAX_BATCH_SIZE - 1; i++) {
      client.track(makeNavEvent({ toPath: `/page/${i}` }));
    }
    expect(mockTransport.send).not.toHaveBeenCalled();

    // The MAX_BATCH_SIZE-th event should trigger an auto-flush
    client.track(makeNavEvent({ toPath: "/page/final" }));

    await vi.waitFor(() => expect(mockTransport.send).toHaveBeenCalledOnce());

    const [[batch]] = mockTransport.send.mock.calls as [[TelemetryEvent[]]];
    expect(batch).toHaveLength(MAX_BATCH_SIZE);
  });

  it("holds events below MAX_BATCH_SIZE without flushing", () => {
    const mockTransport = makeMockTransport();
    const client = createTelemetryClient({
      mode: "endpoint",
      sessionId: "hold-session",
      transport: mockTransport,
    });

    for (let i = 0; i < MAX_BATCH_SIZE - 1; i++) {
      client.track(makeNavEvent());
    }

    expect(mockTransport.send).not.toHaveBeenCalled();
    expect(client.peekQueue()).toHaveLength(MAX_BATCH_SIZE - 1);

    // Cleanup
    client.reset();
  });
});

// ─── Console mode — immediate flush ──────────────────────────────────────────

describe("console mode", () => {
  beforeEach(() => {
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "groupEnd").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes immediately after each track() call in console mode", async () => {
    const mockTransport = makeMockTransport();
    const client = createTelemetryClient({
      mode: "console",
      sessionId: "console-session",
      transport: mockTransport,
    });

    client.track(makeNavEvent({ toPath: "/first" }));
    await vi.waitFor(() => expect(mockTransport.send).toHaveBeenCalledOnce());

    client.track(makeNavEvent({ toPath: "/second" }));
    await vi.waitFor(() => expect(mockTransport.send).toHaveBeenCalledTimes(2));
  });

  it("sends exactly one event per track() call in console mode", async () => {
    const mockTransport = makeMockTransport();
    const client = createTelemetryClient({
      mode: "console",
      sessionId: "console-session",
      transport: mockTransport,
    });

    client.track(makeNavEvent({ toPath: "/solo" }));
    await vi.waitFor(() => expect(mockTransport.send).toHaveBeenCalledOnce());

    const [[batch]] = mockTransport.send.mock.calls as [[TelemetryEvent[]]];
    expect(batch).toHaveLength(1);
  });
});

// ─── Noop mode ────────────────────────────────────────────────────────────────

describe("noop mode", () => {
  it("never calls transport.send", () => {
    const mockTransport = makeMockTransport();
    const client = createTelemetryClient({
      mode: "noop",
      sessionId: "noop-session",
      transport: mockTransport,
    });

    // Track more than MAX_BATCH_SIZE to confirm no flush is triggered
    for (let i = 0; i < MAX_BATCH_SIZE + 5; i++) {
      client.track(makeNavEvent());
    }
    expect(mockTransport.send).not.toHaveBeenCalled();
  });

  it("still enqueues events for test assertions via drainQueue()", () => {
    const client = makeNoopClient();
    client.track(makeNavEvent({ toPath: "/assert-me" }));
    const [event] = client.drainQueue();
    expect(event).toMatchObject({ toPath: "/assert-me" });
  });
});

// ─── Endpoint transport — default URL ────────────────────────────────────────

describe("DEFAULT_TELEMETRY_ENDPOINT", () => {
  it("is /api/telemetry", () => {
    expect(DEFAULT_TELEMETRY_ENDPOINT).toBe("/api/telemetry");
  });
});

// ─── getSessionId() ───────────────────────────────────────────────────────────

describe("TelemetryClient.getSessionId()", () => {
  it("returns the pinned sessionId when provided via options", () => {
    const client = createTelemetryClient({ sessionId: "fixed-id", mode: "noop" });
    expect(client.getSessionId()).toBe("fixed-id");
  });

  it("returns a UUID-shaped string when not pinned", () => {
    // In a test environment (node, no sessionStorage) getOrCreateSessionId
    // returns generateUUID() directly, which follows UUID v4 format.
    const client = createTelemetryClient({ mode: "noop" });
    expect(client.getSessionId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

// ─── Error event integration ──────────────────────────────────────────────────

describe("tracking error events", () => {
  it("enqueues an error event with correct fields", () => {
    const client = makeNoopClient();
    client.track({
      eventCategory: "error",
      eventName: TelemetryEventName.ERROR_QR_SCAN_FAILED,
      app: "scan",
      errorCode: "QR_DECODE_TIMEOUT",
      errorMessage: "Camera timed out after 10 seconds without a decode.",
      recoverable: true,
      attemptDurationMs: 10_000,
    });

    const [event] = client.drainQueue();
    expect(event.eventCategory).toBe("error");
    expect(event.eventName).toBe(TelemetryEventName.ERROR_QR_SCAN_FAILED);
    expect(event).toMatchObject({
      errorCode: "QR_DECODE_TIMEOUT",
      recoverable: true,
      attemptDurationMs: 10_000,
    });
  });
});

// ─── Performance event integration ───────────────────────────────────────────

describe("tracking performance events", () => {
  it("enqueues a performance event with correct fields", () => {
    const client = makeNoopClient();
    client.track({
      eventCategory: "performance",
      eventName: TelemetryEventName.PERF_REALTIME_LATENCY,
      app: "scan",
      durationMs: 850,
      withinTarget: true,
      triggerMutation: "scan:submitDamagePhoto",
      mutationSubmittedAt: 1_000_000,
      subscriptionUpdatedAt: 1_000_850,
      withinFidelityTarget: true,
    });

    const [event] = client.drainQueue();
    expect(event.eventCategory).toBe("performance");
    expect(event.eventName).toBe(TelemetryEventName.PERF_REALTIME_LATENCY);
    expect(event).toMatchObject({
      durationMs: 850,
      withinTarget: true,
      withinFidelityTarget: true,
    });
  });
});

// ─── createTelemetryClient factory ───────────────────────────────────────────

describe("createTelemetryClient()", () => {
  it("returns a TelemetryClient instance", () => {
    expect(createTelemetryClient()).toBeInstanceOf(TelemetryClient);
  });

  it("respects the mode override", () => {
    const client = createTelemetryClient({ mode: "console" });
    expect(client.mode).toBe("console");
  });

  it("two clients with different sessionIds have independent state", () => {
    const a = createTelemetryClient({ mode: "noop", sessionId: "session-a" });
    const b = createTelemetryClient({ mode: "noop", sessionId: "session-b" });

    a.identify("user_a");
    expect(b.getIdentity().userId).toBeUndefined();

    a.track(makeNavEvent());
    expect(a.peekQueue()).toHaveLength(1);
    expect(b.peekQueue()).toHaveLength(0);
  });
});

// ─── getDeviceContext ─────────────────────────────────────────────────────────

describe("getDeviceContext()", () => {
  it("returns an object in jsdom (window is defined)", () => {
    // jsdom provides window/navigator/screen — we expect a context object
    const ctx = getDeviceContext();
    expect(ctx).not.toBeUndefined();
    expect(ctx).toBeTypeOf("object");
  });

  it("returns userAgent as a string (max 512 chars)", () => {
    const ctx = getDeviceContext();
    expect(ctx).not.toBeUndefined();
    expect(typeof ctx!.userAgent).toBe("string");
    expect(ctx!.userAgent.length).toBeLessThanOrEqual(512);
  });

  it("returns language as a string", () => {
    const ctx = getDeviceContext();
    expect(ctx).not.toBeUndefined();
    expect(typeof ctx!.language).toBe("string");
    expect(ctx!.language.length).toBeGreaterThan(0);
  });

  it("returns numeric screenWidth and screenHeight", () => {
    const ctx = getDeviceContext();
    expect(ctx).not.toBeUndefined();
    expect(typeof ctx!.screenWidth).toBe("number");
    expect(typeof ctx!.screenHeight).toBe("number");
  });

  it("returns numeric viewportWidth and viewportHeight", () => {
    const ctx = getDeviceContext();
    expect(ctx).not.toBeUndefined();
    expect(typeof ctx!.viewportWidth).toBe("number");
    expect(typeof ctx!.viewportHeight).toBe("number");
  });

  it("returns touchSupport as a boolean", () => {
    const ctx = getDeviceContext();
    expect(ctx).not.toBeUndefined();
    expect(typeof ctx!.touchSupport).toBe("boolean");
  });

  it("returns connectionType as a string", () => {
    const ctx = getDeviceContext();
    expect(ctx).not.toBeUndefined();
    expect(typeof ctx!.connectionType).toBe("string");
    // NetworkInformation API is unavailable in jsdom — should fall back to "unknown"
    expect(ctx!.connectionType).toBe("unknown");
  });

  it("returns devicePixelRatio as a number (≥ 1)", () => {
    const ctx = getDeviceContext();
    expect(ctx).not.toBeUndefined();
    expect(typeof ctx!.devicePixelRatio).toBe("number");
    expect(ctx!.devicePixelRatio).toBeGreaterThanOrEqual(1);
  });

  it("truncates userAgent longer than 512 chars", () => {
    const longUA = "A".repeat(600);
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: longUA,
      configurable: true,
    });

    const ctx = getDeviceContext();
    expect(ctx!.userAgent.length).toBeLessThanOrEqual(512);

    // Restore
    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
  });
});

// ─── Device context enrichment via TelemetryClient ───────────────────────────

/** A deterministic device context for test assertions. */
const testDeviceContext: DeviceContext = {
  userAgent: "TestBrowser/1.0 (jsdom)",
  language: "en-US",
  screenWidth: 390,
  screenHeight: 844,
  viewportWidth: 390,
  viewportHeight: 700,
  touchSupport: true,
  connectionType: "4g",
  devicePixelRatio: 3,
};

describe("TelemetryClient — device context enrichment", () => {
  it("auto-injects device context into tracked events", () => {
    const client = createTelemetryClient({
      mode: "noop",
      sessionId: "device-test-session",
      deviceContext: testDeviceContext,
    });

    client.track(makeNavEvent());
    const [event] = client.drainQueue();

    expect(event.device).toEqual(testDeviceContext);
  });

  it("uses caller-supplied device override in track() input", () => {
    const override: DeviceContext = { ...testDeviceContext, viewportWidth: 768 };
    const client = createTelemetryClient({
      mode: "noop",
      sessionId: "device-override-session",
      deviceContext: testDeviceContext,
    });

    client.track({ ...makeNavEvent(), device: override });
    const [event] = client.drainQueue();

    expect(event.device?.viewportWidth).toBe(768);
  });

  it("leaves device undefined when deviceContext: null is passed (opt-out)", () => {
    const client = createTelemetryClient({
      mode: "noop",
      sessionId: "no-device-session",
      deviceContext: null,
    });

    client.track(makeNavEvent());
    const [event] = client.drainQueue();

    expect(event.device).toBeUndefined();
  });

  it("getDeviceContext() returns the injected device context", () => {
    const client = createTelemetryClient({
      mode: "noop",
      deviceContext: testDeviceContext,
    });

    expect(client.getDeviceContext()).toEqual(testDeviceContext);
  });

  it("setDeviceContext() replaces the device context for subsequent events", () => {
    const client = createTelemetryClient({
      mode: "noop",
      sessionId: "set-device-session",
      deviceContext: testDeviceContext,
    });

    const updated: DeviceContext = { ...testDeviceContext, viewportWidth: 1024 };
    client.setDeviceContext(updated);

    client.track(makeNavEvent());
    const [event] = client.drainQueue();

    expect(event.device?.viewportWidth).toBe(1024);
  });

  it("setDeviceContext(undefined) removes device context from subsequent events", () => {
    const client = createTelemetryClient({
      mode: "noop",
      sessionId: "remove-device-session",
      deviceContext: testDeviceContext,
    });

    client.setDeviceContext(undefined);
    client.track(makeNavEvent());
    const [event] = client.drainQueue();

    expect(event.device).toBeUndefined();
  });

  it("two clients can have independent device contexts", () => {
    const desktop: DeviceContext = { ...testDeviceContext, touchSupport: false, viewportWidth: 1440 };
    const mobile: DeviceContext = { ...testDeviceContext, touchSupport: true, viewportWidth: 390 };

    const desktopClient = createTelemetryClient({ mode: "noop", deviceContext: desktop });
    const mobileClient  = createTelemetryClient({ mode: "noop", deviceContext: mobile });

    desktopClient.track(makeNavEvent());
    mobileClient.track(makeNavEvent());

    const [desktopEvent] = desktopClient.drainQueue();
    const [mobileEvent]  = mobileClient.drainQueue();

    expect(desktopEvent.device?.touchSupport).toBe(false);
    expect(mobileEvent.device?.touchSupport).toBe(true);
  });
});

// ─── trackEvent convenience function ─────────────────────────────────────────

describe("trackEvent()", () => {
  it("is exported from the module", () => {
    expect(typeof trackEvent).toBe("function");
  });

  it("delegates to the telemetry singleton without throwing", () => {
    // In NODE_ENV=test, the singleton uses noop transport.
    // Just verify it runs without error.
    expect(() => {
      trackEvent({
        eventCategory: "navigation",
        eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
        app: "scan",
        toPath: "/scan/test-track-event",
        fromPath: null,
      });
    }).not.toThrow();
  });

  it("accepts user_action events", () => {
    expect(() => {
      trackEvent({
        eventCategory: "user_action",
        eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
        app: "scan",
        success: true,
        scanDurationMs: 250,
        method: "camera",
      });
    }).not.toThrow();
  });

  it("accepts error events", () => {
    expect(() => {
      trackEvent({
        eventCategory: "error",
        eventName: TelemetryEventName.ERROR_CAMERA_DENIED,
        app: "scan",
        errorCode: "CAMERA_DENIED",
        errorMessage: "User denied camera permission.",
        recoverable: false,
        permissionName: "camera",
      });
    }).not.toThrow();
  });

  it("accepts performance events", () => {
    expect(() => {
      trackEvent({
        eventCategory: "performance",
        eventName: TelemetryEventName.PERF_MAP_ENDPOINT,
        app: "inventory",
        durationMs: 145,
        withinTarget: true,
        mapView: "M1",
        caseCount: 42,
      });
    }).not.toThrow();
  });
});
