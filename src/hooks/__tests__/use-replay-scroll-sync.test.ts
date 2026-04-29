/**
 * @vitest-environment jsdom
 *
 * src/hooks/__tests__/use-replay-scroll-sync.test.ts
 *
 * Unit tests for useReplayScrollSync — the hook that scrolls the active stop
 * card into view whenever the replay cursor advances or is manually scrubbed.
 *
 * Test coverage
 * ─────────────
 *
 * Basic scroll call:
 *   1.  Calls scrollIntoView when activeIndex is set and element exists.
 *   2.  Calls scrollIntoView with { behavior: "smooth", block: "nearest" } by default.
 *   3.  Does NOT call scrollIntoView when activeIndex is null.
 *   4.  Does NOT call scrollIntoView when listRef.current is null.
 *   5.  Does NOT call scrollIntoView when no element with matching data-stop-index.
 *   6.  Does NOT throw when element is not found (graceful no-op).
 *
 * scrollBehavior parameter:
 *   7.  Passes scrollBehavior="instant" to scrollIntoView when specified.
 *   8.  Passes scrollBehavior="auto" to scrollIntoView when specified.
 *   9.  Defaults to scrollBehavior="smooth" when not specified.
 *
 * Re-render / change detection:
 *  10.  Re-calls scrollIntoView when activeIndex changes (cursor advances).
 *  11.  Does NOT re-call scrollIntoView when activeIndex stays the same.
 *  12.  Re-calls scrollIntoView when activeIndex goes from null to a value.
 *  13.  Does NOT scroll after activeIndex returns to null.
 *  14.  Scrolls to the new element when activeIndex advances past a boundary.
 *  15.  Scrolls to the correct element matching the new activeIndex.
 *
 * Targeting:
 *  16.  Targets the element with data-stop-index matching activeIndex.
 *  17.  Does not scroll when data-stop-index is present but for a different index.
 *  18.  Finds deeply nested element with matching data-stop-index.
 *
 * Mocking strategy
 * ────────────────
 * • window.HTMLElement.prototype.scrollIntoView is replaced with a vi.fn() spy.
 *   This works because jsdom does not implement scrollIntoView natively.
 * • DOM elements are created manually and attached to document.body so the
 *   querySelector calls work correctly.
 * • vi.restoreAllMocks() in afterEach cleans up the prototype spy.
 */

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useReplayScrollSync } from "../use-replay-scroll-sync";

// ─── Helper: build a minimal list DOM structure ───────────────────────────────

/**
 * Creates an <ol> element with <li> children, each having data-stop-index=N.
 * Appended to document.body so querySelector works.
 * Returns { containerEl, cleanup }.
 */
function buildList(stopIndices: number[]): {
  containerEl: HTMLOListElement;
  cleanup: () => void;
} {
  const containerEl = document.createElement("ol");

  for (const idx of stopIndices) {
    const li = document.createElement("li");
    li.setAttribute("data-stop-index", String(idx));
    containerEl.appendChild(li);
  }

  document.body.appendChild(containerEl);

  return {
    containerEl,
    cleanup: () => {
      if (containerEl.parentNode) {
        document.body.removeChild(containerEl);
      }
    },
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoViewSpy = vi.fn();
  // Replace scrollIntoView on the prototype so all HTMLElements use the spy.
  // jsdom does not implement scrollIntoView, so this is always undefined without
  // this assignment.
  window.HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy as unknown as HTMLElement["scrollIntoView"];
});

afterEach(() => {
  // Restore the original prototype method (vi.restoreAllMocks does not
  // restore prototype assignments, so we set it back to undefined explicitly).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window.HTMLElement.prototype as any).scrollIntoView = undefined;
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useReplayScrollSync — basic scroll call", () => {
  it("1. calls scrollIntoView when activeIndex is set and element exists", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    try {
      renderHook(() =>
        useReplayScrollSync({ listRef, activeIndex: 2 })
      );
      expect(scrollIntoViewSpy).toHaveBeenCalledOnce();
    } finally {
      cleanup();
    }
  });

  it("2. calls scrollIntoView with { behavior: 'smooth', block: 'nearest' } by default", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    try {
      renderHook(() =>
        useReplayScrollSync({ listRef, activeIndex: 1 })
      );
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "nearest",
      });
    } finally {
      cleanup();
    }
  });

  it("3. does NOT call scrollIntoView when activeIndex is null", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    try {
      renderHook(() =>
        useReplayScrollSync({ listRef, activeIndex: null })
      );
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("4. does NOT call scrollIntoView when listRef.current is null", () => {
    renderHook(() =>
      useReplayScrollSync({ listRef: { current: null }, activeIndex: 2 })
    );
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it("5. does NOT call scrollIntoView when no element with matching data-stop-index", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    try {
      // activeIndex=99 — no element with data-stop-index="99" in the list
      renderHook(() =>
        useReplayScrollSync({ listRef, activeIndex: 99 })
      );
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("6. does NOT throw when element is not found", () => {
    const { containerEl, cleanup } = buildList([1, 2]);
    const listRef = { current: containerEl };

    try {
      expect(() => {
        renderHook(() =>
          useReplayScrollSync({ listRef, activeIndex: 99 })
        );
      }).not.toThrow();
    } finally {
      cleanup();
    }
  });
});

describe("useReplayScrollSync — scrollBehavior parameter", () => {
  it("7. passes scrollBehavior='instant' when specified", () => {
    const { containerEl, cleanup } = buildList([1]);
    const listRef = { current: containerEl };

    try {
      renderHook(() =>
        useReplayScrollSync({
          listRef,
          activeIndex: 1,
          scrollBehavior: "instant",
        })
      );
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: "instant",
        block: "nearest",
      });
    } finally {
      cleanup();
    }
  });

  it("8. passes scrollBehavior='auto' when specified", () => {
    const { containerEl, cleanup } = buildList([1]);
    const listRef = { current: containerEl };

    try {
      renderHook(() =>
        useReplayScrollSync({
          listRef,
          activeIndex: 1,
          scrollBehavior: "auto",
        })
      );
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: "auto",
        block: "nearest",
      });
    } finally {
      cleanup();
    }
  });

  it("9. defaults to scrollBehavior='smooth' when not specified", () => {
    const { containerEl, cleanup } = buildList([1]);
    const listRef = { current: containerEl };

    try {
      renderHook(() =>
        useReplayScrollSync({ listRef, activeIndex: 1 })
      );
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "nearest",
      });
    } finally {
      cleanup();
    }
  });
});

describe("useReplayScrollSync — re-render / change detection", () => {
  it("10. re-calls scrollIntoView when activeIndex changes (cursor advances)", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    try {
      const { rerender } = renderHook(
        ({ index }: { index: number | null }) =>
          useReplayScrollSync({ listRef, activeIndex: index }),
        { initialProps: { index: 1 as number | null } }
      );

      // Initial render: scroll to stop 1
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

      // Replay cursor advances to stop 2
      rerender({ index: 2 });

      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2);
    } finally {
      cleanup();
    }
  });

  it("11. does NOT re-call scrollIntoView when activeIndex stays the same", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    try {
      const { rerender } = renderHook(
        ({ index }: { index: number | null }) =>
          useReplayScrollSync({ listRef, activeIndex: index }),
        { initialProps: { index: 2 as number | null } }
      );

      // Initial render: scroll called once
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

      // Rerender with same index (e.g., `at` changed but still within same stop)
      rerender({ index: 2 });

      // No additional scroll — activeIndex did not change
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("12. re-calls scrollIntoView when activeIndex goes from null to a value", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    try {
      const { rerender } = renderHook(
        ({ index }: { index: number | null }) =>
          useReplayScrollSync({ listRef, activeIndex: index }),
        { initialProps: { index: null as number | null } }
      );

      // null → no scroll
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();

      // Replay starts: cursor advances to stop 1
      rerender({ index: 1 });

      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("13. does NOT call scrollIntoView after activeIndex returns to null", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    try {
      const { rerender } = renderHook(
        ({ index }: { index: number | null }) =>
          useReplayScrollSync({ listRef, activeIndex: index }),
        { initialProps: { index: 2 as number | null } }
      );

      // Reset to live mode (at=null → no active stop)
      rerender({ index: null });

      // The spy was called once on initial render (index=2), but NOT on the null rerender
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("14. scrolls to the correct new element when activeIndex advances past a boundary", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    // Track which element was the scroll target
    const scrollTargets: string[] = [];
    scrollIntoViewSpy.mockImplementation(function (
      this: HTMLElement,
      _options: ScrollIntoViewOptions
    ) {
      scrollTargets.push(this.getAttribute("data-stop-index") ?? "unknown");
    });

    try {
      const { rerender } = renderHook(
        ({ index }: { index: number | null }) =>
          useReplayScrollSync({ listRef, activeIndex: index }),
        { initialProps: { index: 1 as number | null } }
      );

      rerender({ index: 2 });
      rerender({ index: 3 });

      expect(scrollTargets).toEqual(["1", "2", "3"]);
    } finally {
      cleanup();
    }
  });

  it("15. scrolls to the correct element matching the new activeIndex", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    let lastScrollTarget: string | null = null;
    scrollIntoViewSpy.mockImplementation(function (
      this: HTMLElement,
      _options: ScrollIntoViewOptions
    ) {
      lastScrollTarget = this.getAttribute("data-stop-index");
    });

    try {
      const { rerender } = renderHook(
        ({ index }: { index: number | null }) =>
          useReplayScrollSync({ listRef, activeIndex: index }),
        { initialProps: { index: 1 as number | null } }
      );

      expect(lastScrollTarget).toBe("1");

      rerender({ index: 3 });
      expect(lastScrollTarget).toBe("3");
    } finally {
      cleanup();
    }
  });
});

describe("useReplayScrollSync — targeting", () => {
  it("16. targets the element with data-stop-index matching activeIndex", () => {
    const { containerEl, cleanup } = buildList([1, 2, 3]);
    const listRef = { current: containerEl };

    let scrolledEl: HTMLElement | null = null;
    scrollIntoViewSpy.mockImplementation(function (
      this: HTMLElement,
      _opts: ScrollIntoViewOptions
    ) {
      scrolledEl = this;
    });

    try {
      renderHook(() =>
        useReplayScrollSync({ listRef, activeIndex: 2 })
      );

      expect(scrolledEl).not.toBeNull();
      expect(scrolledEl!.getAttribute("data-stop-index")).toBe("2");
    } finally {
      cleanup();
    }
  });

  it("17. does not scroll when only elements with non-matching data-stop-index are present", () => {
    const { containerEl, cleanup } = buildList([10, 20, 30]);
    const listRef = { current: containerEl };

    try {
      // Looking for index 5 — not in the list
      renderHook(() =>
        useReplayScrollSync({ listRef, activeIndex: 5 })
      );
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("18. finds a deeply nested element with matching data-stop-index", () => {
    // Build a structure: <ol> > <li> > <div data-stop-index="2"> </div> </li> </ol>
    const containerEl = document.createElement("ol");
    const li = document.createElement("li");
    const innerDiv = document.createElement("div");
    innerDiv.setAttribute("data-stop-index", "2");
    li.appendChild(innerDiv);
    containerEl.appendChild(li);
    document.body.appendChild(containerEl);

    const listRef = { current: containerEl };

    try {
      renderHook(() =>
        useReplayScrollSync({ listRef, activeIndex: 2 })
      );
      expect(scrollIntoViewSpy).toHaveBeenCalledOnce();
    } finally {
      document.body.removeChild(containerEl);
    }
  });
});
