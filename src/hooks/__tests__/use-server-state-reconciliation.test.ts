/**
 * @vitest-environment jsdom
 *
 * Tests for use-server-state-reconciliation
 *
 * Sub-AC 2c: Server-state reconciliation handling for the SCAN mobile app.
 *
 * Coverage matrix
 * ───────────────
 *
 * shallowEqual helper:
 *   ✓ equal primitives return true
 *   ✓ unequal primitives return false
 *   ✓ null vs null returns true
 *   ✓ null vs non-null returns false
 *   ✓ objects with same keys/values return true
 *   ✓ objects with different values return false
 *   ✓ objects with different key counts return false
 *   ✓ undefined === undefined returns true
 *   ✓ undefined vs any returns false
 *
 * detectDivergence helper:
 *   ✓ returns empty array when all predicted fields match server values
 *   ✓ returns divergence records for each mismatched field
 *   ✓ ignores fields present in predictions but absent from serverValues
 *   ✓ includes field name, predicted value, and actual value in each record
 *   ✓ handles multiple diverged fields in one call
 *   ✓ handles empty predictions map
 *
 * useServerStateReconciliation hook:
 *
 *   trackMutation:
 *     ✓ pendingCount increments after trackMutation
 *     ✓ pendingCount increments for each tracked mutation
 *     ✓ dismissed state resets when a new mutation is tracked
 *
 *   confirmMutation — no divergence:
 *     ✓ pendingCount decrements after confirmMutation
 *     ✓ hasDivergence remains false when all fields match
 *     ✓ divergedFields remains empty when all fields match
 *
 *   confirmMutation — divergence detected:
 *     ✓ hasDivergence becomes true when a field diverges
 *     ✓ divergedFields contains one record per diverged field
 *     ✓ divergence record contains correct field, predicted, and actual values
 *     ✓ pendingCount decrements even when divergence is detected
 *
 *   cancelMutation:
 *     ✓ pendingCount decrements after cancelMutation
 *     ✓ hasDivergence does NOT become true after cancelMutation (no comparison)
 *     ✓ existing divergedFields are preserved after cancelMutation
 *
 *   dismiss:
 *     ✓ hasDivergence becomes false after dismiss
 *     ✓ divergedFields is cleared after dismiss
 *     ✓ new mutations can re-trigger divergence after dismiss
 *
 *   stale detection:
 *     ✓ isStale is false initially
 *     ✓ isStale becomes true when a mutation exceeds STALE_THRESHOLD_MS
 *     ✓ isStale returns to false after confirmMutation clears stale mutation
 *     ✓ staleSince is null initially
 *     ✓ staleSince is set when stale detection triggers
 *     ✓ staleSince returns to null after stale mutation is resolved
 *
 *   confirmMutation with unknown id:
 *     ✓ noop when id not found — no state change
 *
 *   cancelMutation with unknown id:
 *     ✓ noop when id not found — no state change
 *
 *   multiple concurrent mutations:
 *     ✓ pendingCount reflects all in-flight mutations
 *     ✓ confirming one does not affect others
 *     ✓ divergence from second mutation replaces first divergence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useServerStateReconciliation,
  shallowEqual,
  detectDivergence,
  STALE_THRESHOLD_MS,
} from "../use-server-state-reconciliation";

// ─── shallowEqual tests ───────────────────────────────────────────────────────

describe("shallowEqual", () => {
  it("returns true for identical primitive strings", () => {
    expect(shallowEqual("transit_out", "transit_out")).toBe(true);
  });

  it("returns false for different primitive strings", () => {
    expect(shallowEqual("transit_out", "transit_in")).toBe(false);
  });

  it("returns true for identical numbers", () => {
    expect(shallowEqual(42, 42)).toBe(true);
  });

  it("returns false for different numbers", () => {
    expect(shallowEqual(1, 2)).toBe(false);
  });

  it("returns true for null vs null", () => {
    expect(shallowEqual(null, null)).toBe(true);
  });

  it("returns false for null vs non-null", () => {
    expect(shallowEqual(null, "hello")).toBe(false);
    expect(shallowEqual("hello", null)).toBe(false);
  });

  it("returns true for undefined vs undefined", () => {
    expect(shallowEqual(undefined, undefined)).toBe(true);
  });

  it("returns false for undefined vs any non-undefined value", () => {
    expect(shallowEqual(undefined, null)).toBe(false);
    expect(shallowEqual(undefined, "")).toBe(false);
    expect(shallowEqual("value", undefined)).toBe(false);
  });

  it("returns true for objects with identical key/value pairs", () => {
    expect(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
  });

  it("returns false for objects with different values", () => {
    expect(shallowEqual({ status: "ok" }, { status: "damaged" })).toBe(false);
  });

  it("returns false for objects with different key counts", () => {
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("returns true for boolean true vs true", () => {
    expect(shallowEqual(true, true)).toBe(true);
  });

  it("returns false for boolean true vs false", () => {
    expect(shallowEqual(true, false)).toBe(false);
  });
});

// ─── detectDivergence tests ───────────────────────────────────────────────────

describe("detectDivergence", () => {
  it("returns empty array when all predicted fields match server values", () => {
    const predictions = { status: "transit_out", carrier: "FedEx" };
    const serverValues = { status: "transit_out", carrier: "FedEx" };
    expect(detectDivergence(predictions, serverValues)).toHaveLength(0);
  });

  it("returns one record when a single field diverges", () => {
    const predictions = { status: "transit_out" };
    const serverValues = { status: "transit_in" };
    const result = detectDivergence(predictions, serverValues);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      field:     "status",
      predicted: "transit_out",
      actual:    "transit_in",
    });
  });

  it("returns multiple records when multiple fields diverge", () => {
    const predictions = { status: "transit_out", carrier: "FedEx" };
    const serverValues = { status: "transit_in", carrier: "UPS" };
    const result = detectDivergence(predictions, serverValues);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.field === "status")).toEqual({
      field:     "status",
      predicted: "transit_out",
      actual:    "transit_in",
    });
    expect(result.find((r) => r.field === "carrier")).toEqual({
      field:     "carrier",
      predicted: "FedEx",
      actual:    "UPS",
    });
  });

  it("ignores fields present in predictions but absent from serverValues", () => {
    // The server might not return every predicted field in its result object.
    const predictions = { status: "ok", extras: "ignored" };
    const serverValues = { status: "ok" }; // "extras" not in serverValues
    expect(detectDivergence(predictions, serverValues)).toHaveLength(0);
  });

  it("returns empty array for empty predictions map", () => {
    expect(detectDivergence({}, { status: "ok" })).toHaveLength(0);
  });

  it("detects divergence for undefined predicted vs defined actual", () => {
    // If we predicted undefined but server returned a value
    const predictions = { assigneeId: undefined };
    const serverValues = { assigneeId: "user-abc" };
    const result = detectDivergence(predictions, serverValues);
    expect(result).toHaveLength(1);
    expect(result[0].predicted).toBe(undefined);
    expect(result[0].actual).toBe("user-abc");
  });

  it("includes correct field name, predicted value, and actual value", () => {
    const predictions = { newStatus: "deployed" };
    const serverValues = { newStatus: "flagged" };
    const [record] = detectDivergence(predictions, serverValues);
    expect(record.field).toBe("newStatus");
    expect(record.predicted).toBe("deployed");
    expect(record.actual).toBe("flagged");
  });
});

// ─── useServerStateReconciliation tests ──────────────────────────────────────

describe("useServerStateReconciliation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it("starts with hasDivergence=false", () => {
    const { result } = renderHook(() => useServerStateReconciliation());
    expect(result.current.hasDivergence).toBe(false);
  });

  it("starts with divergedFields=[]", () => {
    const { result } = renderHook(() => useServerStateReconciliation());
    expect(result.current.divergedFields).toHaveLength(0);
  });

  it("starts with isStale=false", () => {
    const { result } = renderHook(() => useServerStateReconciliation());
    expect(result.current.isStale).toBe(false);
  });

  it("starts with staleSince=null", () => {
    const { result } = renderHook(() => useServerStateReconciliation());
    expect(result.current.staleSince).toBeNull();
  });

  it("starts with pendingCount=0", () => {
    const { result } = renderHook(() => useServerStateReconciliation());
    expect(result.current.pendingCount).toBe(0);
  });

  // ── trackMutation ──────────────────────────────────────────────────────────

  it("pendingCount increments after trackMutation", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "deployed" });
    });

    expect(result.current.pendingCount).toBe(1);
  });

  it("pendingCount reflects multiple tracked mutations", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "deployed" });
      result.current.trackMutation("mut-2", { status: "transit_out" });
    });

    expect(result.current.pendingCount).toBe(2);
  });

  // ── confirmMutation — no divergence ───────────────────────────────────────

  it("pendingCount decrements after confirmMutation", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "deployed" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "deployed" });
    });

    expect(result.current.pendingCount).toBe(0);
  });

  it("hasDivergence stays false when all fields match", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "transit_out", carrier: "FedEx" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "transit_out", carrier: "FedEx" });
    });

    expect(result.current.hasDivergence).toBe(false);
  });

  it("divergedFields stays empty when all fields match", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "assembled" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "assembled" });
    });

    expect(result.current.divergedFields).toHaveLength(0);
  });

  // ── confirmMutation — divergence detected ─────────────────────────────────

  it("hasDivergence becomes true when a field diverges", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "transit_out" });
    });
    act(() => {
      // Server confirms a different status than predicted
      result.current.confirmMutation("mut-1", { status: "transit_in" });
    });

    expect(result.current.hasDivergence).toBe(true);
  });

  it("divergedFields contains one record per diverged field", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "transit_out", assigneeId: "user-old" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "transit_in", assigneeId: "user-new" });
    });

    expect(result.current.divergedFields).toHaveLength(2);
  });

  it("divergence record contains correct field, predicted, and actual values", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "transit_out" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "transit_in" });
    });

    const [record] = result.current.divergedFields;
    expect(record.field).toBe("status");
    expect(record.predicted).toBe("transit_out");
    expect(record.actual).toBe("transit_in");
  });

  it("pendingCount decrements even when divergence is detected", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "deployed" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "flagged" });
    });

    expect(result.current.pendingCount).toBe(0);
    expect(result.current.hasDivergence).toBe(true);
  });

  // ── cancelMutation ────────────────────────────────────────────────────────

  it("pendingCount decrements after cancelMutation", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "assembled" });
    });
    act(() => {
      result.current.cancelMutation("mut-1");
    });

    expect(result.current.pendingCount).toBe(0);
  });

  it("hasDivergence does NOT become true after cancelMutation", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "assembled" });
    });
    act(() => {
      // Mutation failed; Convex rolled back optimistic update automatically.
      // No divergence — cancelMutation should not trigger the banner.
      result.current.cancelMutation("mut-1");
    });

    expect(result.current.hasDivergence).toBe(false);
    expect(result.current.divergedFields).toHaveLength(0);
  });

  it("existing divergedFields are preserved after cancelMutation", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    // First mutation confirms with divergence
    act(() => {
      result.current.trackMutation("mut-1", { status: "transit_out" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "transit_in" });
    });
    expect(result.current.hasDivergence).toBe(true);

    // Second mutation is tracked and then cancelled
    act(() => {
      result.current.trackMutation("mut-2", { status: "received" });
    });
    act(() => {
      result.current.cancelMutation("mut-2");
    });

    // Existing divergence banner from mut-1 should still be visible
    expect(result.current.hasDivergence).toBe(true);
    expect(result.current.divergedFields).toHaveLength(1);
  });

  // ── dismiss ───────────────────────────────────────────────────────────────

  it("hasDivergence becomes false after dismiss", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "transit_out" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "transit_in" });
    });
    expect(result.current.hasDivergence).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.hasDivergence).toBe(false);
  });

  it("divergedFields is cleared after dismiss", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "deployed" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "flagged" });
    });
    act(() => {
      result.current.dismiss();
    });

    expect(result.current.divergedFields).toHaveLength(0);
  });

  it("new mutations can re-trigger divergence after dismiss", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    // First divergence + dismiss
    act(() => {
      result.current.trackMutation("mut-1", { status: "transit_out" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "transit_in" });
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.hasDivergence).toBe(false);

    // New mutation with a different divergence
    act(() => {
      result.current.trackMutation("mut-2", { assigneeId: "user-a" });
    });
    act(() => {
      result.current.confirmMutation("mut-2", { assigneeId: "user-b" });
    });

    expect(result.current.hasDivergence).toBe(true);
    expect(result.current.divergedFields[0].field).toBe("assigneeId");
  });

  // ── stale detection ───────────────────────────────────────────────────────

  it("isStale is false before STALE_THRESHOLD_MS has elapsed", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "assembled" });
    });

    // Advance time to just before the threshold
    act(() => {
      vi.advanceTimersByTime(STALE_THRESHOLD_MS - 100);
    });

    expect(result.current.isStale).toBe(false);
  });

  it("isStale becomes true when STALE_THRESHOLD_MS has elapsed", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "assembled" });
    });

    // Advance time past the stale threshold + one check interval
    act(() => {
      vi.advanceTimersByTime(STALE_THRESHOLD_MS + 1_500);
    });

    expect(result.current.isStale).toBe(true);
  });

  it("isStale returns to false after the stale mutation is confirmed", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "assembled" });
    });

    act(() => {
      vi.advanceTimersByTime(STALE_THRESHOLD_MS + 1_500);
    });
    expect(result.current.isStale).toBe(true);

    act(() => {
      result.current.confirmMutation("mut-1", { status: "assembled" });
    });

    expect(result.current.isStale).toBe(false);
  });

  it("staleSince is null initially", () => {
    const { result } = renderHook(() => useServerStateReconciliation());
    expect(result.current.staleSince).toBeNull();
  });

  it("staleSince is set when stale detection triggers", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "assembled" });
    });

    act(() => {
      vi.advanceTimersByTime(STALE_THRESHOLD_MS + 1_500);
    });

    expect(result.current.staleSince).not.toBeNull();
    expect(typeof result.current.staleSince).toBe("number");
  });

  it("staleSince returns to null after stale mutation is resolved", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "assembled" });
    });

    act(() => {
      vi.advanceTimersByTime(STALE_THRESHOLD_MS + 1_500);
    });
    expect(result.current.staleSince).not.toBeNull();

    act(() => {
      result.current.cancelMutation("mut-1");
    });

    expect(result.current.staleSince).toBeNull();
  });

  // ── confirmMutation / cancelMutation with unknown id ─────────────────────

  it("confirmMutation with unknown id is a safe noop — no state change", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      // Calling confirm without a corresponding track should not throw
      // or produce any side effects.
      result.current.confirmMutation("unknown-id", { status: "ok" });
    });

    expect(result.current.hasDivergence).toBe(false);
    expect(result.current.pendingCount).toBe(0);
  });

  it("cancelMutation with unknown id is a safe noop — no state change", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.cancelMutation("unknown-id");
    });

    expect(result.current.hasDivergence).toBe(false);
    expect(result.current.pendingCount).toBe(0);
  });

  // ── Multiple concurrent mutations ─────────────────────────────────────────

  it("pendingCount reflects all in-flight mutations simultaneously", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-a", { status: "deployed" });
      result.current.trackMutation("mut-b", { status: "transit_out" });
      result.current.trackMutation("mut-c", { status: "received" });
    });

    expect(result.current.pendingCount).toBe(3);
  });

  it("confirming one mutation does not affect others still in flight", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-a", { status: "deployed" });
      result.current.trackMutation("mut-b", { status: "transit_out" });
    });

    act(() => {
      result.current.confirmMutation("mut-a", { status: "deployed" });
    });

    // mut-b still pending
    expect(result.current.pendingCount).toBe(1);
  });

  it("divergence from a later mutation replaces divergence from an earlier one", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    // First mutation diverges on "status"
    act(() => {
      result.current.trackMutation("mut-1", { status: "transit_out" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "transit_in" });
    });
    expect(result.current.divergedFields[0].field).toBe("status");

    // Second mutation diverges on a different field
    act(() => {
      result.current.trackMutation("mut-2", { assigneeId: "user-a" });
    });
    act(() => {
      result.current.confirmMutation("mut-2", { assigneeId: "user-b" });
    });

    // The banner now shows the second divergence
    expect(result.current.divergedFields).toHaveLength(1);
    expect(result.current.divergedFields[0].field).toBe("assigneeId");
  });

  // ── dismissed state resets on new mutation ────────────────────────────────

  it("dismissed state resets when a new mutation is tracked after dismiss", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    // Trigger + dismiss divergence
    act(() => {
      result.current.trackMutation("mut-1", { status: "transit_out" });
    });
    act(() => {
      result.current.confirmMutation("mut-1", { status: "transit_in" });
    });
    act(() => {
      result.current.dismiss();
    });

    // Track a new mutation — dismissed flag resets
    act(() => {
      result.current.trackMutation("mut-2", { status: "received" });
    });
    act(() => {
      // This mutation also diverges
      result.current.confirmMutation("mut-2", { status: "archived" });
    });

    // Divergence should be visible (not suppressed by old dismiss)
    expect(result.current.hasDivergence).toBe(true);
  });

  // ── Fields absent from serverValues are not flagged ───────────────────────

  it("does not flag a field as diverged when it is absent from serverValues", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", {
        status: "ok",
        notes: "This field will not be in serverValues",
      });
    });
    act(() => {
      // Server only returns "status" — "notes" is absent
      result.current.confirmMutation("mut-1", { status: "ok" });
    });

    expect(result.current.hasDivergence).toBe(false);
  });

  // ── Stale mutations clear when cancelled ──────────────────────────────────

  it("isStale returns to false after a stale mutation is cancelled", () => {
    const { result } = renderHook(() => useServerStateReconciliation());

    act(() => {
      result.current.trackMutation("mut-1", { status: "assembled" });
    });

    act(() => {
      vi.advanceTimersByTime(STALE_THRESHOLD_MS + 1_500);
    });
    expect(result.current.isStale).toBe(true);

    act(() => {
      result.current.cancelMutation("mut-1");
    });

    expect(result.current.isStale).toBe(false);
  });
});
