/**
 * Unit tests: density-sync.ts — pub/sub bridge for Convex↔hook density sync.
 *
 * Tests cover:
 *   A. Convex → Hook direction (apply Convex preferences to hooks)
 *   B. Hook → Convex direction (notify Convex of user-changed density)
 *   C. Subscription lifecycle (subscribe, unsubscribe, cleanup)
 *   D. Multiple subscribers (all receive broadcast)
 *   E. Priority contract (Convex overrides localStorage value in hook)
 *   F. Isolation (SCAN and INVENTORY channels are independent)
 *   G. No-op safety (notify without listener is safe)
 *   H. _resetDensitySyncForTests utility
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Density } from "@/hooks/use-density";
import {
  subscribeToConvexInvDensity,
  subscribeToConvexScanDensity,
  applyConvexInvDensity,
  applyConvexScanDensity,
  onConvexInvDensityChange,
  onConvexScanDensityChange,
  notifyInvDensityChanged,
  notifyScanDensityChanged,
  _resetDensitySyncForTests,
} from "@/lib/density-sync";

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetDensitySyncForTests();
});

// ─── A: Convex → Hook direction ────────────────────────────────────────────────

describe("density-sync — A: Convex → Hook direction (apply)", () => {
  it("calls a subscribed handler when applyConvexInvDensity is called", () => {
    const handler = vi.fn();
    subscribeToConvexInvDensity(handler);

    applyConvexInvDensity("compact");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("compact");
  });

  it("calls a subscribed handler when applyConvexScanDensity is called", () => {
    const handler = vi.fn();
    subscribeToConvexScanDensity(handler);

    applyConvexScanDensity("compact");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("compact");
  });

  it("calls the handler with 'comfy' density value", () => {
    const handler = vi.fn();
    subscribeToConvexInvDensity(handler);

    applyConvexInvDensity("comfy");

    expect(handler).toHaveBeenCalledWith("comfy");
  });

  it("does not call the handler before apply is called", () => {
    const handler = vi.fn();
    subscribeToConvexInvDensity(handler);

    // No apply call
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── B: Hook → Convex direction ────────────────────────────────────────────────

describe("density-sync — B: Hook → Convex direction (notify)", () => {
  it("calls the registered onConvexInvDensityChange handler when notifyInvDensityChanged fires", () => {
    const handler = vi.fn();
    onConvexInvDensityChange(handler);

    notifyInvDensityChanged("compact");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("compact");
  });

  it("calls the registered onConvexScanDensityChange handler when notifyScanDensityChanged fires", () => {
    const handler = vi.fn();
    onConvexScanDensityChange(handler);

    notifyScanDensityChanged("compact");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("compact");
  });

  it("notifyInvDensityChanged is a no-op when no handler is registered", () => {
    // Should not throw
    expect(() => notifyInvDensityChanged("comfy")).not.toThrow();
  });

  it("notifyScanDensityChanged is a no-op when no handler is registered", () => {
    expect(() => notifyScanDensityChanged("compact")).not.toThrow();
  });

  it("passing null to onConvexInvDensityChange unregisters the handler", () => {
    const handler = vi.fn();
    onConvexInvDensityChange(handler);
    onConvexInvDensityChange(null); // unregister

    notifyInvDensityChanged("compact");

    expect(handler).not.toHaveBeenCalled();
  });

  it("passing null to onConvexScanDensityChange unregisters the handler", () => {
    const handler = vi.fn();
    onConvexScanDensityChange(handler);
    onConvexScanDensityChange(null);

    notifyScanDensityChanged("compact");

    expect(handler).not.toHaveBeenCalled();
  });

  it("re-registering with a new handler replaces the old one", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    onConvexInvDensityChange(handler1);
    onConvexInvDensityChange(handler2); // replaces handler1

    notifyInvDensityChanged("compact");

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});

// ─── C: Subscription lifecycle ────────────────────────────────────────────────

describe("density-sync — C: Subscription lifecycle", () => {
  it("unsubscribe function removes the handler (inv)", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToConvexInvDensity(handler);

    unsubscribe(); // should remove handler

    applyConvexInvDensity("compact");

    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribe function removes the handler (scan)", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToConvexScanDensity(handler);

    unsubscribe();

    applyConvexScanDensity("compact");

    expect(handler).not.toHaveBeenCalled();
  });

  it("calling unsubscribe does not affect other subscribers", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unsub1 = subscribeToConvexInvDensity(handler1);
    subscribeToConvexInvDensity(handler2);

    unsub1();

    applyConvexInvDensity("compact");

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("calling unsubscribe twice is a no-op (does not throw)", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToConvexInvDensity(handler);

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow(); // second call should be safe
  });
});

// ─── D: Multiple subscribers ──────────────────────────────────────────────────

describe("density-sync — D: Multiple subscribers", () => {
  it("all subscribers receive the broadcast when applyConvexInvDensity is called", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    subscribeToConvexInvDensity(handler1);
    subscribeToConvexInvDensity(handler2);
    subscribeToConvexInvDensity(handler3);

    applyConvexInvDensity("compact");

    expect(handler1).toHaveBeenCalledWith("compact");
    expect(handler2).toHaveBeenCalledWith("compact");
    expect(handler3).toHaveBeenCalledWith("compact");
  });

  it("all scan subscribers receive the broadcast", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    subscribeToConvexScanDensity(handler1);
    subscribeToConvexScanDensity(handler2);

    applyConvexScanDensity("comfy");

    expect(handler1).toHaveBeenCalledWith("comfy");
    expect(handler2).toHaveBeenCalledWith("comfy");
  });

  it("broadcast fires exactly once per call, not per subscriber count", () => {
    const handler = vi.fn();
    subscribeToConvexInvDensity(handler);

    applyConvexInvDensity("compact"); // one call
    applyConvexInvDensity("comfy");   // second call

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

// ─── E: Priority contract ─────────────────────────────────────────────────────

describe("density-sync — E: Priority contract (Convex overrides localStorage)", () => {
  it("subsequent applyConvexInvDensity call overrides first (simulates priority)", () => {
    const receivedValues: Density[] = [];
    subscribeToConvexInvDensity((d) => receivedValues.push(d));

    // Simulates: localStorage loads "compact" first, then Convex resolves "comfy"
    applyConvexInvDensity("compact"); // initial (from mock localStorage)
    applyConvexInvDensity("comfy");   // Convex override (wins)

    // The last received value is the Convex value
    expect(receivedValues[receivedValues.length - 1]).toBe("comfy");
  });

  it("notifyInvDensityChanged followed by applyConvexInvDensity demonstrates two-way sync", () => {
    // User sets compact → hook notifies Convex → Convex confirms back
    const hookReceived: Density[] = [];
    const convexReceived: Density[] = [];

    subscribeToConvexInvDensity((d) => hookReceived.push(d));
    onConvexInvDensityChange((d) => convexReceived.push(d));

    // User changes density in the INVENTORY app
    notifyInvDensityChanged("compact"); // hook → Convex

    // Convex confirms the value (from a subsequent query result)
    applyConvexInvDensity("compact"); // Convex → hook

    expect(convexReceived).toEqual(["compact"]);
    expect(hookReceived).toEqual(["compact"]);
  });
});

// ─── F: Channel isolation ──────────────────────────────────────────────────────

describe("density-sync — F: SCAN and INVENTORY channels are independent", () => {
  it("applyConvexInvDensity does NOT fire scan subscribers", () => {
    const invHandler  = vi.fn();
    const scanHandler = vi.fn();

    subscribeToConvexInvDensity(invHandler);
    subscribeToConvexScanDensity(scanHandler);

    applyConvexInvDensity("compact");

    expect(invHandler).toHaveBeenCalledTimes(1);
    expect(scanHandler).not.toHaveBeenCalled();
  });

  it("applyConvexScanDensity does NOT fire inv subscribers", () => {
    const invHandler  = vi.fn();
    const scanHandler = vi.fn();

    subscribeToConvexInvDensity(invHandler);
    subscribeToConvexScanDensity(scanHandler);

    applyConvexScanDensity("compact");

    expect(invHandler).not.toHaveBeenCalled();
    expect(scanHandler).toHaveBeenCalledTimes(1);
  });

  it("notifyInvDensityChanged does NOT fire onConvexScanDensityChange", () => {
    const invListener  = vi.fn();
    const scanListener = vi.fn();

    onConvexInvDensityChange(invListener);
    onConvexScanDensityChange(scanListener);

    notifyInvDensityChanged("compact");

    expect(invListener).toHaveBeenCalledTimes(1);
    expect(scanListener).not.toHaveBeenCalled();
  });

  it("notifyScanDensityChanged does NOT fire onConvexInvDensityChange", () => {
    const invListener  = vi.fn();
    const scanListener = vi.fn();

    onConvexInvDensityChange(invListener);
    onConvexScanDensityChange(scanListener);

    notifyScanDensityChanged("compact");

    expect(invListener).not.toHaveBeenCalled();
    expect(scanListener).toHaveBeenCalledTimes(1);
  });

  it("INV and SCAN can independently have 'compact' and 'comfy' preferences", () => {
    const invReceived:  Density[] = [];
    const scanReceived: Density[] = [];

    subscribeToConvexInvDensity((d) => invReceived.push(d));
    subscribeToConvexScanDensity((d) => scanReceived.push(d));

    applyConvexInvDensity("compact");  // INVENTORY = compact
    applyConvexScanDensity("comfy");   // SCAN = comfy

    expect(invReceived).toEqual(["compact"]);
    expect(scanReceived).toEqual(["comfy"]);
  });
});

// ─── G: No-op safety ──────────────────────────────────────────────────────────

describe("density-sync — G: No-op safety", () => {
  it("applyConvexInvDensity with no subscribers is safe (no throw)", () => {
    expect(() => applyConvexInvDensity("compact")).not.toThrow();
  });

  it("applyConvexScanDensity with no subscribers is safe (no throw)", () => {
    expect(() => applyConvexScanDensity("comfy")).not.toThrow();
  });

  it("notifyInvDensityChanged with no handler is safe (no throw)", () => {
    expect(() => notifyInvDensityChanged("compact")).not.toThrow();
  });

  it("notifyScanDensityChanged with no handler is safe (no throw)", () => {
    expect(() => notifyScanDensityChanged("comfy")).not.toThrow();
  });

  it("onConvexInvDensityChange(null) with no prior registration is safe", () => {
    expect(() => onConvexInvDensityChange(null)).not.toThrow();
  });
});

// ─── H: _resetDensitySyncForTests ─────────────────────────────────────────────

describe("density-sync — H: _resetDensitySyncForTests", () => {
  it("clears all inv subscribers after reset", () => {
    const handler = vi.fn();
    subscribeToConvexInvDensity(handler);

    _resetDensitySyncForTests();

    applyConvexInvDensity("compact");
    expect(handler).not.toHaveBeenCalled();
  });

  it("clears all scan subscribers after reset", () => {
    const handler = vi.fn();
    subscribeToConvexScanDensity(handler);

    _resetDensitySyncForTests();

    applyConvexScanDensity("compact");
    expect(handler).not.toHaveBeenCalled();
  });

  it("clears the inv density change handler after reset", () => {
    const handler = vi.fn();
    onConvexInvDensityChange(handler);

    _resetDensitySyncForTests();

    notifyInvDensityChanged("compact");
    expect(handler).not.toHaveBeenCalled();
  });

  it("clears the scan density change handler after reset", () => {
    const handler = vi.fn();
    onConvexScanDensityChange(handler);

    _resetDensitySyncForTests();

    notifyScanDensityChanged("compact");
    expect(handler).not.toHaveBeenCalled();
  });
});
