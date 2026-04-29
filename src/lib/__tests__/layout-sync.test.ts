/**
 * Unit tests: layout-sync.ts — pub/sub bridge for Convex↔hook layout sync.
 *
 * Tests cover:
 *   A. Convex → Hook direction (apply Convex preferences to hooks)
 *   B. Hook → Convex direction (notify Convex of user-changed preferences)
 *   C. Subscription lifecycle (subscribe, unsubscribe, cleanup)
 *   D. Multiple subscribers (all receive broadcast)
 *   E. No-op safety (notify without listener is safe, apply without subscriber)
 *   F. _resetLayoutSyncForTests utility
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LayoutPrefs } from "@/lib/layout-sync";
import {
  subscribeToConvexLayoutPrefs,
  applyConvexLayoutPrefs,
  onConvexLayoutPrefsChange,
  notifyLayoutPrefsChanged,
  _resetLayoutSyncForTests,
} from "@/lib/layout-sync";

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetLayoutSyncForTests();
});

// ─── A: Convex → Hook direction ────────────────────────────────────────────────

describe("layout-sync — A: Convex → Hook direction (apply)", () => {
  it("calls a subscribed handler when applyConvexLayoutPrefs is called", () => {
    const handler = vi.fn();
    subscribeToConvexLayoutPrefs(handler);

    applyConvexLayoutPrefs({ activeMapMode: "M2" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ activeMapMode: "M2" });
  });

  it("calls the handler with activeCaseLayout", () => {
    const handler = vi.fn();
    subscribeToConvexLayoutPrefs(handler);

    applyConvexLayoutPrefs({ activeCaseLayout: "T3" });

    expect(handler).toHaveBeenCalledWith({ activeCaseLayout: "T3" });
  });

  it("calls the handler with a full preferences patch", () => {
    const handler = vi.fn();
    subscribeToConvexLayoutPrefs(handler);

    const fullPrefs: LayoutPrefs = {
      activeMapMode: "M4",
      activeCaseLayout: "T2",
      sidebarCollapsed: true,
      lastViewedCaseId: "case_abc123",
    };

    applyConvexLayoutPrefs(fullPrefs);

    expect(handler).toHaveBeenCalledWith(fullPrefs);
  });

  it("does not call the handler after it has been unsubscribed", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToConvexLayoutPrefs(handler);

    unsubscribe(); // remove before apply

    applyConvexLayoutPrefs({ activeMapMode: "M3" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw when no handlers are subscribed", () => {
    expect(() => applyConvexLayoutPrefs({ activeMapMode: "M1" })).not.toThrow();
  });
});

// ─── B: Hook → Convex direction ────────────────────────────────────────────────

describe("layout-sync — B: Hook → Convex direction (notify)", () => {
  it("calls the registered change handler when notifyLayoutPrefsChanged is called", () => {
    const handler = vi.fn();
    onConvexLayoutPrefsChange(handler);

    notifyLayoutPrefsChanged({ activeMapMode: "M2" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ activeMapMode: "M2" });
  });

  it("calls the handler with activeCaseLayout change", () => {
    const handler = vi.fn();
    onConvexLayoutPrefsChange(handler);

    notifyLayoutPrefsChanged({ activeCaseLayout: "T4" });

    expect(handler).toHaveBeenCalledWith({ activeCaseLayout: "T4" });
  });

  it("does not throw when notifyLayoutPrefsChanged is called with no registered handler", () => {
    expect(() =>
      notifyLayoutPrefsChanged({ activeMapMode: "M1" })
    ).not.toThrow();
  });

  it("stops calling old handler after onConvexLayoutPrefsChange(null)", () => {
    const handler = vi.fn();
    onConvexLayoutPrefsChange(handler);
    onConvexLayoutPrefsChange(null); // unregister

    notifyLayoutPrefsChanged({ activeMapMode: "M2" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("replaces previous handler when onConvexLayoutPrefsChange is called twice", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    onConvexLayoutPrefsChange(handler1);
    onConvexLayoutPrefsChange(handler2); // replaces handler1

    notifyLayoutPrefsChanged({ activeMapMode: "M3" });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});

// ─── C: Subscription lifecycle ─────────────────────────────────────────────────

describe("layout-sync — C: Subscription lifecycle", () => {
  it("returns an unsubscribe function from subscribeToConvexLayoutPrefs", () => {
    const unsubscribe = subscribeToConvexLayoutPrefs(vi.fn());
    expect(typeof unsubscribe).toBe("function");
  });

  it("unsubscribe removes the handler so it no longer receives broadcasts", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToConvexLayoutPrefs(handler);

    unsubscribe();
    applyConvexLayoutPrefs({ activeMapMode: "M2" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribing one handler does not remove other subscribed handlers", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unsubscribe1 = subscribeToConvexLayoutPrefs(handler1);
    subscribeToConvexLayoutPrefs(handler2);

    unsubscribe1();
    applyConvexLayoutPrefs({ activeMapMode: "M4" });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("calling unsubscribe multiple times is a no-op (idempotent)", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToConvexLayoutPrefs(handler);

    unsubscribe();
    unsubscribe(); // second call should not throw
    applyConvexLayoutPrefs({ activeMapMode: "M1" });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── D: Multiple subscribers ──────────────────────────────────────────────────

describe("layout-sync — D: Multiple subscribers", () => {
  it("broadcasts to all active subscribers", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    subscribeToConvexLayoutPrefs(handler1);
    subscribeToConvexLayoutPrefs(handler2);
    subscribeToConvexLayoutPrefs(handler3);

    applyConvexLayoutPrefs({ activeCaseLayout: "T5" });

    expect(handler1).toHaveBeenCalledWith({ activeCaseLayout: "T5" });
    expect(handler2).toHaveBeenCalledWith({ activeCaseLayout: "T5" });
    expect(handler3).toHaveBeenCalledWith({ activeCaseLayout: "T5" });
  });

  it("broadcasts each time applyConvexLayoutPrefs is called", () => {
    const handler = vi.fn();
    subscribeToConvexLayoutPrefs(handler);

    applyConvexLayoutPrefs({ activeMapMode: "M2" });
    applyConvexLayoutPrefs({ activeCaseLayout: "T3" });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, { activeMapMode: "M2" });
    expect(handler).toHaveBeenNthCalledWith(2, { activeCaseLayout: "T3" });
  });
});

// ─── E: No-op safety ─────────────────────────────────────────────────────────

describe("layout-sync — E: No-op safety", () => {
  it("applyConvexLayoutPrefs is safe with no subscribers", () => {
    expect(() => applyConvexLayoutPrefs({ activeMapMode: "M1" })).not.toThrow();
  });

  it("notifyLayoutPrefsChanged is safe with no registered handler", () => {
    expect(() =>
      notifyLayoutPrefsChanged({ activeCaseLayout: "T1" })
    ).not.toThrow();
  });

  it("onConvexLayoutPrefsChange(null) is safe when no handler was registered", () => {
    expect(() => onConvexLayoutPrefsChange(null)).not.toThrow();
  });
});

// ─── F: _resetLayoutSyncForTests ─────────────────────────────────────────────

describe("layout-sync — F: _resetLayoutSyncForTests", () => {
  it("clears all apply subscribers", () => {
    const handler = vi.fn();
    subscribeToConvexLayoutPrefs(handler);

    _resetLayoutSyncForTests();

    applyConvexLayoutPrefs({ activeMapMode: "M2" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("clears the change handler", () => {
    const handler = vi.fn();
    onConvexLayoutPrefsChange(handler);

    _resetLayoutSyncForTests();

    notifyLayoutPrefsChanged({ activeMapMode: "M2" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("makes subsequent subscriptions work normally after reset", () => {
    const handler1 = vi.fn();
    subscribeToConvexLayoutPrefs(handler1);

    _resetLayoutSyncForTests();

    const handler2 = vi.fn();
    subscribeToConvexLayoutPrefs(handler2);
    applyConvexLayoutPrefs({ activeMapMode: "M3" });

    expect(handler1).not.toHaveBeenCalled(); // was cleared
    expect(handler2).toHaveBeenCalledWith({ activeMapMode: "M3" });
  });
});
