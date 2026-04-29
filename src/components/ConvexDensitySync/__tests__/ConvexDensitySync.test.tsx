/**
 * @vitest-environment jsdom
 *
 * Unit tests: ConvexDensitySync — Convex↔localStorage priority reconciliation.
 *
 * Tests verify the priority contract:
 *   1. Convex wins when authenticated (stored pref applied after auth resolves)
 *   2. localStorage used as fallback (Convex null/loading → no override)
 *   3. Changes written back to Convex after initial sync
 *   4. Write-back guard: no writes before Convex resolves
 *   5. Deduplication: identical density not written to Convex twice
 *   6. Both apps (inv and scan) synced independently
 *
 * Mocking strategy:
 *   - `convex/react` useQuery/useMutation are vi.mock'd
 *   - `@/lib/density-sync` functions are tested via real module (not mock)
 *     so we can verify the full pub/sub integration
 */

import React, { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Density } from "@/hooks/use-density";
import {
  subscribeToConvexInvDensity,
  subscribeToConvexScanDensity,
  notifyInvDensityChanged,
  notifyScanDensityChanged,
  _resetDensitySyncForTests,
} from "@/lib/density-sync";

// ─── Convex mock ──────────────────────────────────────────────────────────────

const mockPersistDensity = vi.fn().mockResolvedValue(undefined);
let mockPrefsValue: {
  invDensity: Density | null;
  scanDensity: Density | null;
} | null | undefined = undefined;

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => mockPrefsValue),
  useMutation: vi.fn(() => mockPersistDensity),
}));

// ─── ConvexDensitySync import (after mock) ────────────────────────────────────

import { ConvexDensitySync } from "../ConvexDensitySync";

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _resetDensitySyncForTests();
  mockPrefsValue = undefined;
  mockPersistDensity.mockClear();
});

afterEach(() => {
  cleanup();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function renderSync() {
  return render(<ConvexDensitySync />);
}

// ─── 1: Convex wins when authenticated ────────────────────────────────────────

describe("ConvexDensitySync — 1: Convex wins when authenticated", () => {
  it("broadcasts invDensity from Convex to subscribed hooks", async () => {
    const invReceived: Density[] = [];
    subscribeToConvexInvDensity((d) => invReceived.push(d));

    // Simulate Convex returning a stored preference
    mockPrefsValue = { invDensity: "compact", scanDensity: null };
    renderSync();

    await act(async () => {});

    expect(invReceived).toEqual(["compact"]);
  });

  it("broadcasts scanDensity from Convex to subscribed hooks", async () => {
    const scanReceived: Density[] = [];
    subscribeToConvexScanDensity((d) => scanReceived.push(d));

    mockPrefsValue = { invDensity: null, scanDensity: "compact" };
    renderSync();

    await act(async () => {});

    expect(scanReceived).toEqual(["compact"]);
  });

  it("broadcasts both inv and scan preferences when both are stored", async () => {
    const invReceived:  Density[] = [];
    const scanReceived: Density[] = [];

    subscribeToConvexInvDensity((d) => invReceived.push(d));
    subscribeToConvexScanDensity((d) => scanReceived.push(d));

    mockPrefsValue = { invDensity: "compact", scanDensity: "compact" };
    renderSync();

    await act(async () => {});

    expect(invReceived).toEqual(["compact"]);
    expect(scanReceived).toEqual(["compact"]);
  });

  it("applies Convex 'comfy' preference (not just 'compact')", async () => {
    const invReceived: Density[] = [];
    subscribeToConvexInvDensity((d) => invReceived.push(d));

    mockPrefsValue = { invDensity: "comfy", scanDensity: null };
    renderSync();

    await act(async () => {});

    expect(invReceived).toEqual(["comfy"]);
  });
});

// ─── 2: localStorage fallback when Convex returns null ───────────────────────

describe("ConvexDensitySync — 2: localStorage fallback (null/no pref)", () => {
  it("does NOT broadcast when invDensity is null (no stored preference)", async () => {
    const invReceived: Density[] = [];
    subscribeToConvexInvDensity((d) => invReceived.push(d));

    mockPrefsValue = { invDensity: null, scanDensity: null };
    renderSync();

    await act(async () => {});

    // No broadcast — localStorage/default should remain
    expect(invReceived).toEqual([]);
  });

  it("does NOT broadcast when Convex returns null (unauthenticated)", async () => {
    const invReceived: Density[] = [];
    subscribeToConvexInvDensity((d) => invReceived.push(d));

    mockPrefsValue = null; // unauthenticated
    renderSync();

    await act(async () => {});

    expect(invReceived).toEqual([]);
  });

  it("does NOT broadcast while query is loading (undefined)", async () => {
    const invReceived: Density[] = [];
    subscribeToConvexInvDensity((d) => invReceived.push(d));

    mockPrefsValue = undefined; // still loading
    renderSync();

    await act(async () => {});

    expect(invReceived).toEqual([]);
  });
});

// ─── 3: Write-back to Convex after initial sync ───────────────────────────────

describe("ConvexDensitySync — 3: Write-back to Convex", () => {
  it("persists INVENTORY density change to Convex after sync", async () => {
    mockPrefsValue = { invDensity: null, scanDensity: null };
    renderSync();
    await act(async () => {});

    // Simulate user changing density in INVENTORY app
    await act(async () => {
      notifyInvDensityChanged("compact");
    });

    expect(mockPersistDensity).toHaveBeenCalledWith({
      app: "inv",
      density: "compact",
    });
  });

  it("persists SCAN density change to Convex after sync", async () => {
    mockPrefsValue = { invDensity: null, scanDensity: null };
    renderSync();
    await act(async () => {});

    await act(async () => {
      notifyScanDensityChanged("compact");
    });

    expect(mockPersistDensity).toHaveBeenCalledWith({
      app: "scan",
      density: "compact",
    });
  });
});

// ─── 4: Write-back guard (no writes before sync) ─────────────────────────────

describe("ConvexDensitySync — 4: Write-back guard (no pre-sync writes)", () => {
  it("does NOT persist density before Convex resolves (undefined)", async () => {
    mockPrefsValue = undefined; // Convex still loading
    renderSync();
    await act(async () => {});

    // Simulate density change before Convex resolves
    await act(async () => {
      notifyInvDensityChanged("compact");
    });

    // Should NOT have been called because synced flag is not set yet
    expect(mockPersistDensity).not.toHaveBeenCalled();
  });
});

// ─── 5: Deduplication ────────────────────────────────────────────────────────

describe("ConvexDensitySync — 5: Deduplication (no redundant writes)", () => {
  it("does not write the same density value twice in a row", async () => {
    mockPrefsValue = { invDensity: null, scanDensity: null };
    renderSync();
    await act(async () => {});

    await act(async () => {
      notifyInvDensityChanged("compact");
      notifyInvDensityChanged("compact"); // same value again
    });

    // Should only have been called once (second is deduplicated)
    const calls = mockPersistDensity.mock.calls.filter(
      ([arg]) => arg.app === "inv"
    );
    expect(calls).toHaveLength(1);
  });

  it("writes again when density changes to a different value", async () => {
    mockPrefsValue = { invDensity: null, scanDensity: null };
    renderSync();
    await act(async () => {});

    await act(async () => {
      notifyInvDensityChanged("compact");
      notifyInvDensityChanged("comfy"); // different value
    });

    const calls = mockPersistDensity.mock.calls.filter(
      ([arg]) => arg.app === "inv"
    );
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toEqual({ app: "inv", density: "compact" });
    expect(calls[1][0]).toEqual({ app: "inv", density: "comfy" });
  });
});

// ─── 6: Both apps sync independently ─────────────────────────────────────────

describe("ConvexDensitySync — 6: INV and SCAN sync independently", () => {
  it("INVENTORY and SCAN density changes produce separate Convex writes", async () => {
    mockPrefsValue = { invDensity: null, scanDensity: null };
    renderSync();
    await act(async () => {});

    await act(async () => {
      notifyInvDensityChanged("compact");
      notifyScanDensityChanged("comfy");
    });

    const invCalls  = mockPersistDensity.mock.calls.filter(([a]) => a.app === "inv");
    const scanCalls = mockPersistDensity.mock.calls.filter(([a]) => a.app === "scan");

    expect(invCalls).toHaveLength(1);
    expect(invCalls[0][0]).toEqual({ app: "inv", density: "compact" });

    expect(scanCalls).toHaveLength(1);
    expect(scanCalls[0][0]).toEqual({ app: "scan", density: "comfy" });
  });

  it("INVENTORY sync does not interfere with SCAN state", async () => {
    const scanReceived: Density[] = [];
    subscribeToConvexScanDensity((d) => scanReceived.push(d));

    mockPrefsValue = { invDensity: "compact", scanDensity: null };
    renderSync();
    await act(async () => {});

    // Only INVENTORY broadcast should fire
    expect(scanReceived).toEqual([]);
  });
});
