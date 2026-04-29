/**
 * @vitest-environment jsdom
 *
 * Tests for useDistinctCaseActors — Sub-AC 3 of AC 160103.
 *
 * The hook wraps `api["queries/events"].getDistinctActors`, a Convex query
 * that returns a deduplicated, alphabetically-sorted list of actor display-
 * names for all events recorded against a case.
 *
 * Coverage matrix
 * ───────────────
 * useDistinctCaseActors:
 *   ✓ passes caseId to underlying useQuery as { caseId }
 *   ✓ passes "skip" when caseId is null
 *   ✓ passes "skip" when caseId is undefined
 *   ✓ passes "skip" when caseId is an empty string
 *   ✓ returns undefined while loading (query in-flight)
 *   ✓ returns an empty array when no events exist for the case
 *   ✓ returns a sorted actor name array when events exist
 *   ✓ returns the value provided by useQuery unchanged
 *
 * Mocking strategy
 * ────────────────
 * We mock `convex/react` so `useQuery` is a vi.fn() we can control.
 * We mock the generated `api` object so the path
 * `(api as any)["queries/events"]?.getDistinctActors` resolves to a
 * stable Symbol — confirming the hook passes the correct query reference.
 * The tests never hit a real Convex backend.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Stable symbol for the getDistinctActors query reference.
const { MOCK_GET_DISTINCT_ACTORS } = vi.hoisted(() => ({
  MOCK_GET_DISTINCT_ACTORS: Symbol("getDistinctActors"),
}));

// Mock the generated Convex API so the `["queries/events"]` path resolves.
vi.mock("../../../convex/_generated/api", () => ({
  api: {
    "queries/events": {
      getDistinctActors: MOCK_GET_DISTINCT_ACTORS,
    },
    // Minimal stubs so other imports in use-case-events.ts don't throw.
    cases: {},
    checklists: {},
  },
}));

// Capture all useQuery / usePaginatedQuery invocations.
const mockUseQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery:          (...args: unknown[]) => mockUseQuery(...args),
  usePaginatedQuery: vi.fn().mockReturnValue({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));

// Import AFTER vi.mock calls.
import { useDistinctCaseActors } from "../use-case-events";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CASE_ID = "case-id-abc123";

/** Return [queryRef, args] from the most recent useQuery call. */
function lastQueryCall(): [unknown, unknown] {
  const calls = mockUseQuery.mock.calls;
  return calls[calls.length - 1] as [unknown, unknown];
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockUseQuery.mockReset();
  mockUseQuery.mockReturnValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useDistinctCaseActors", () => {
  // ── Query reference ──────────────────────────────────────────────────────

  it("passes the getDistinctActors query reference as the first arg", () => {
    mockUseQuery.mockReturnValue([]);
    renderHook(() => useDistinctCaseActors(CASE_ID));
    const [queryRef] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_DISTINCT_ACTORS);
  });

  // ── caseId forwarding ────────────────────────────────────────────────────

  it("passes { caseId } as args when caseId is a non-empty string", () => {
    mockUseQuery.mockReturnValue([]);
    renderHook(() => useDistinctCaseActors(CASE_ID));
    const [, args] = lastQueryCall();
    expect(args).toEqual({ caseId: CASE_ID });
  });

  // ── Skip pattern ─────────────────────────────────────────────────────────

  it("passes 'skip' when caseId is null", () => {
    renderHook(() => useDistinctCaseActors(null));
    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it("passes 'skip' when caseId is undefined", () => {
    renderHook(() => useDistinctCaseActors(undefined));
    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it("passes 'skip' when caseId is an empty string", () => {
    renderHook(() => useDistinctCaseActors(""));
    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  // ── Return value passthrough ─────────────────────────────────────────────

  it("returns undefined while the query is loading", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useDistinctCaseActors(CASE_ID));
    expect(result.current).toBeUndefined();
  });

  it("returns an empty array when no events exist for the case", () => {
    mockUseQuery.mockReturnValue([]);
    const { result } = renderHook(() => useDistinctCaseActors(CASE_ID));
    expect(result.current).toEqual([]);
  });

  it("returns the actor name array provided by useQuery", () => {
    const actors = ["Alice", "Bob", "System"];
    mockUseQuery.mockReturnValue(actors);
    const { result } = renderHook(() => useDistinctCaseActors(CASE_ID));
    expect(result.current).toEqual(actors);
  });

  it("returns a single-element array when only one actor exists", () => {
    mockUseQuery.mockReturnValue(["Jane Doe"]);
    const { result } = renderHook(() => useDistinctCaseActors(CASE_ID));
    expect(result.current).toEqual(["Jane Doe"]);
  });

  it("returns a multi-element sorted array unchanged", () => {
    // The server sorts — the hook does not re-sort, just passes through.
    const sorted = ["Alice", "Bob", "Charlie", "System"];
    mockUseQuery.mockReturnValue(sorted);
    const { result } = renderHook(() => useDistinctCaseActors(CASE_ID));
    expect(result.current).toEqual(sorted);
  });

  // ── Reactive update ──────────────────────────────────────────────────────

  it("reflects a new actor name when the Convex subscription pushes an update", () => {
    mockUseQuery.mockReturnValue(["Alice"]);
    const { result, rerender } = renderHook(() =>
      useDistinctCaseActors(CASE_ID),
    );
    expect(result.current).toEqual(["Alice"]);

    // Simulate Convex pushing an updated list after a new actor acts.
    mockUseQuery.mockReturnValue(["Alice", "Bob"]);
    rerender();
    expect(result.current).toEqual(["Alice", "Bob"]);
  });

  it("returns undefined again after a reconnect (loading state)", () => {
    mockUseQuery.mockReturnValue(["Alice"]);
    const { result, rerender } = renderHook(() =>
      useDistinctCaseActors(CASE_ID),
    );
    expect(result.current).toEqual(["Alice"]);

    // Simulate reconnect / re-fetch — Convex returns undefined temporarily.
    mockUseQuery.mockReturnValue(undefined);
    rerender();
    expect(result.current).toBeUndefined();
  });

  // ── Skip → active transition ─────────────────────────────────────────────

  it("transitions from skip to active when caseId changes from null to a string", () => {
    mockUseQuery.mockReturnValue(undefined);
    let caseId: string | null = null;
    const { result, rerender } = renderHook(() =>
      useDistinctCaseActors(caseId),
    );

    // While skipped, useQuery is called with "skip" — the hook returns undefined.
    const [, firstArgs] = lastQueryCall();
    expect(firstArgs).toBe("skip");

    // Change caseId to a real value.
    mockUseQuery.mockReturnValue(["Alice"]);
    caseId = CASE_ID;
    rerender();

    const [, secondArgs] = lastQueryCall();
    expect(secondArgs).toEqual({ caseId: CASE_ID });
    expect(result.current).toEqual(["Alice"]);
  });
});
