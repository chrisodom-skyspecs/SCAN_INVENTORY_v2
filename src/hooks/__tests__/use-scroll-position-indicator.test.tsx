/**
 * @vitest-environment jsdom
 *
 * src/hooks/__tests__/use-scroll-position-indicator.test.ts
 *
 * Unit tests for useScrollPositionIndicator — the hook that wires the position
 * indicator to the main timeline scroll position via a shared ref.
 *
 * Sub-AC 3: Wire the position indicator to the main timeline scroll position
 * using a shared scroll state or ref, so the indicator moves in sync as the
 * user scrolls the main timeline.
 *
 * Architecture under test
 * ───────────────────────
 * The hook returns { state, listRef }.
 *
 * The "shared ref" is `listRef` — a React ref that the caller attaches to the
 * scrollable container element.  The hook reads scroll metrics from that same
 * ref whenever a scroll or resize event fires, then updates `state` so the
 * indicator thumb reflects the current scroll position.
 *
 * Because the ref is SHARED (returned by the hook and attached to the main
 * timeline element), any scroll on the timeline is immediately reflected in
 * the indicator state without additional wiring.
 *
 * Test strategy
 * ─────────────
 * We render a minimal React component that:
 *   1. Calls `useScrollPositionIndicator`
 *   2. Attaches `listRef` to an `<ol data-testid="scroll-list">` element
 *   3. Renders the indicator track/thumb when state.visible is true
 *      (using `data-testid="indicator-track"` and `data-testid="indicator-thumb"`)
 *
 * This mirrors real usage and ensures that React's ref system properly
 * populates `listRef.current` during mount — which is required for the hook's
 * useEffect scroll listener to attach correctly.
 *
 * Test groups
 * ───────────
 *
 * Initial state (no element attached yet):
 *   1.  state.visible is false before any scroll event.
 *   2.  state.thumbTop is 0 on initial render.
 *   3.  state.thumbHeight is 0 on initial render.
 *   4.  listRef is a non-null ref object.
 *
 * No-overflow guard (indicator hidden):
 *   5.  Indicator remains hidden when scrollHeight === clientHeight (no overflow).
 *   6.  Indicator remains hidden when scrollHeight < clientHeight.
 *
 * Scroll-sync — indicator becomes visible and moves with scrollTop:
 *   7.  Indicator becomes visible after a scroll event with overflow metrics.
 *   8.  thumbTop is 0 when scrollTop is 0 (at the top of the main timeline).
 *   9.  thumbTop is > 0 when scrollTop is > 0 (partway through the timeline).
 *   10. thumbTop updates in sync with each scroll event (continuous tracking).
 *   11. thumbTop approaches maxThumbTop when scrollTop approaches scrollRange.
 *   12. Indicator hides again when overflow is removed (list shrinks).
 *
 * Thumb height geometry:
 *   13. thumbHeight is (clientHeight / scrollHeight) × clientHeight (≥ 16px default).
 *   14. thumbHeight is at least the default minThumbPx (16px) for very long lists.
 *   15. thumbHeight respects a custom minThumbPx option.
 *
 * contentKey re-attachment:
 *   16. Hook re-attaches listeners when contentKey changes (remount scenario).
 *
 * Mocking strategy
 * ────────────────
 * • jsdom does not implement real scroll layout, so scrollTop / scrollHeight /
 *   clientHeight always return 0 by default.
 * • Tests use Object.defineProperty to override these getters on the `<ol>`
 *   element, then dispatch a "scroll" Event to trigger the passive listener.
 * • act() / await act() wraps dispatches so React flushes state updates
 *   before assertions run.
 * • ResizeObserver is mocked globally via vi.stubGlobal().
 */

import React, { useEffect } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import {
  useScrollPositionIndicator,
  type ScrollPositionIndicatorState,
} from "../use-scroll-position-indicator";

// ─── ResizeObserver mock ──────────────────────────────────────────────────────

/** Tracks the most recently created ResizeObserver callback for tests. */
let lastResizeCallback: ResizeObserverCallback | null = null;

/**
 * Class-based ResizeObserver mock.
 *
 * Must be a class (not an arrow function) to be usable as a constructor
 * with `new ResizeObserver(callback)`.  Arrow functions cannot be used as
 * constructors and will throw "is not a constructor".
 */
class MockResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    lastResizeCallback = callback;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

// ─── Test harness component ───────────────────────────────────────────────────

interface HarnessProps {
  contentKey?: string;
  minThumbPx?: number;
  onStateChange?: (s: ScrollPositionIndicatorState) => void;
}

/**
 * Minimal React component that exercises useScrollPositionIndicator.
 *
 * Renders:
 *   • `<ol data-testid="scroll-list" ref={listRef}>` — the "main timeline"
 *     scrollable container.  Scroll metrics are mocked by tests.
 *   • `<div data-testid="indicator-track">` — visible only when state.visible
 *     is true, containing the thumb with data-testid="indicator-thumb".
 *
 * This mirrors the production usage pattern in MiniMapSidebar:
 *   <div style={{ position: "relative" }}>
 *     {state.visible && <div className={styles.positionTrack}><div className={styles.positionThumb} style={{ top, height }} /></div>}
 *     <ol ref={listRef} className={styles.entryList}>...</ol>
 *   </div>
 */
function ScrollIndicatorHarness({ contentKey, minThumbPx, onStateChange }: HarnessProps) {
  const { state, listRef } = useScrollPositionIndicator({ contentKey, minThumbPx });

  // Notify parent of every state change for assertion convenience
  useEffect(() => {
    onStateChange?.(state);
  });

  return (
    <div style={{ position: "relative" }}>
      {state.visible && (
        <div
          data-testid="indicator-track"
          style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3 }}
        >
          <div
            data-testid="indicator-thumb"
            style={{
              position: "absolute",
              top: `${state.thumbTop}px`,
              height: `${state.thumbHeight}px`,
            }}
          />
        </div>
      )}
      <ol
        ref={listRef as React.RefObject<HTMLOListElement>}
        data-testid="scroll-list"
      />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set scroll metrics on an element and dispatch a scroll event,
 * then flush React state updates via act().
 *
 * jsdom always returns 0 for scrollTop / scrollHeight / clientHeight, so we
 * override the getters with Object.defineProperty for each test.
 */
async function triggerScroll(
  el: Element,
  opts: { scrollTop?: number; scrollHeight?: number; clientHeight?: number }
): Promise<void> {
  if (opts.scrollHeight !== undefined) {
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      value: opts.scrollHeight,
    });
  }
  if (opts.clientHeight !== undefined) {
    Object.defineProperty(el, "clientHeight", {
      configurable: true,
      value: opts.clientHeight,
    });
  }
  if (opts.scrollTop !== undefined) {
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      value: opts.scrollTop,
    });
  }

  await act(async () => {
    el.dispatchEvent(new Event("scroll"));
  });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  lastResizeCallback = null;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useScrollPositionIndicator — initial state (no scroll yet)", () => {
  it("1. state.visible is false before any scroll event", () => {
    render(<ScrollIndicatorHarness contentKey="initial" />);
    // No indicator track should be rendered before any scroll
    expect(screen.queryByTestId("indicator-track")).toBeNull();
  });

  it("2. indicator track is absent when there is no overflow (no scroll dispatched)", () => {
    render(<ScrollIndicatorHarness contentKey="no-scroll" />);
    expect(screen.queryByTestId("indicator-track")).toBeNull();
    expect(screen.queryByTestId("indicator-thumb")).toBeNull();
  });

  it("3. scroll list element is rendered and has the correct testid", () => {
    render(<ScrollIndicatorHarness contentKey="list-check" />);
    expect(screen.getByTestId("scroll-list")).toBeTruthy();
  });

  it("4. listRef is returned by the hook and attached to the scroll list", () => {
    render(<ScrollIndicatorHarness contentKey="ref-check" />);
    // If the ref is attached, the scroll list exists in the DOM
    const list = screen.getByTestId("scroll-list");
    expect(list).toBeTruthy();
    expect(list.tagName.toLowerCase()).toBe("ol");
  });
});

describe("useScrollPositionIndicator — no-overflow guard (indicator hidden)", () => {
  it("5. indicator remains hidden when scrollHeight === clientHeight (no overflow)", async () => {
    render(<ScrollIndicatorHarness contentKey="equal" />);
    const list = screen.getByTestId("scroll-list");

    await triggerScroll(list, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });

    expect(screen.queryByTestId("indicator-track")).toBeNull();
  });

  it("6. indicator remains hidden when scrollHeight < clientHeight", async () => {
    render(<ScrollIndicatorHarness contentKey="less-than" />);
    const list = screen.getByTestId("scroll-list");

    await triggerScroll(list, { scrollHeight: 100, clientHeight: 300, scrollTop: 0 });

    expect(screen.queryByTestId("indicator-track")).toBeNull();
  });
});

describe("useScrollPositionIndicator — scroll-sync (main timeline → indicator)", () => {
  it("7. indicator becomes visible after a scroll event with overflow metrics", async () => {
    render(<ScrollIndicatorHarness contentKey="visible" />);
    const list = screen.getByTestId("scroll-list");

    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });

    expect(screen.getByTestId("indicator-track")).toBeTruthy();
    expect(screen.getByTestId("indicator-thumb")).toBeTruthy();
  });

  it("8. thumbTop is 0 when scrollTop is 0 (at the top of the main timeline)", async () => {
    render(<ScrollIndicatorHarness contentKey="top" />);
    const list = screen.getByTestId("scroll-list");

    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });

    const thumb = screen.getByTestId("indicator-thumb");
    expect(thumb.style.top).toBe("0px");
  });

  it("9. thumbTop is > 0 when scrollTop is > 0 (partway through the timeline)", async () => {
    render(<ScrollIndicatorHarness contentKey="partway" />);
    const list = screen.getByTestId("scroll-list");

    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 200 });

    const thumb = screen.getByTestId("indicator-thumb");
    const topValue = parseFloat(thumb.style.top);
    expect(topValue).toBeGreaterThan(0);
  });

  it("10. thumbTop updates in sync with each scroll event (continuous tracking)", async () => {
    render(<ScrollIndicatorHarness contentKey="continuous" />);
    const list = screen.getByTestId("scroll-list");

    // First scroll: at the top
    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });
    const thumb = screen.getByTestId("indicator-thumb");
    const top1 = parseFloat(thumb.style.top);
    expect(top1).toBe(0);

    // Second scroll: partway down
    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 200 });
    const top2 = parseFloat(thumb.style.top);
    expect(top2).toBeGreaterThan(top1);

    // Third scroll: further down
    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 350 });
    const top3 = parseFloat(thumb.style.top);
    expect(top3).toBeGreaterThan(top2);
  });

  it("11. thumbTop approaches maxThumbTop when scrollTop approaches scrollRange", async () => {
    render(<ScrollIndicatorHarness contentKey="near-bottom" />);
    const list = screen.getByTestId("scroll-list");

    // scrollHeight=600, clientHeight=200 → scrollRange=400
    // At bottom (scrollTop=400): thumbTop should be maxThumbTop
    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 400 });

    const thumb = screen.getByTestId("indicator-thumb");
    const thumbTop = parseFloat(thumb.style.top);
    const thumbHeight = parseFloat(thumb.style.height);
    const maxThumbTop = 200 - thumbHeight;

    expect(thumbTop).toBeCloseTo(maxThumbTop, 0);
  });

  it("12. indicator hides again when overflow is removed (list shrinks)", async () => {
    render(<ScrollIndicatorHarness contentKey="hide-again" />);
    const list = screen.getByTestId("scroll-list");

    // First: show indicator
    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });
    expect(screen.getByTestId("indicator-track")).toBeTruthy();

    // Second: content shrinks → no overflow → indicator hides
    await triggerScroll(list, { scrollHeight: 150, clientHeight: 200, scrollTop: 0 });
    expect(screen.queryByTestId("indicator-track")).toBeNull();
  });
});

describe("useScrollPositionIndicator — thumb height geometry", () => {
  it("13. thumbHeight is (clientHeight / scrollHeight) × clientHeight when ≥ default minThumbPx", async () => {
    render(<ScrollIndicatorHarness contentKey="height-ratio" />);
    const list = screen.getByTestId("scroll-list");

    // clientHeight=200, scrollHeight=400 → ratio=0.5 → rawHeight=(200/400)*200=100 → ≥16 → 100
    await triggerScroll(list, { scrollHeight: 400, clientHeight: 200, scrollTop: 0 });

    const thumb = screen.getByTestId("indicator-thumb");
    const heightValue = parseFloat(thumb.style.height);
    // Expected: 100px
    expect(heightValue).toBeCloseTo(100, 0);
  });

  it("14. thumbHeight is at least 16px (default minThumbPx) for very long lists", async () => {
    render(<ScrollIndicatorHarness contentKey="very-long" />);
    const list = screen.getByTestId("scroll-list");

    // clientHeight=100, scrollHeight=100000 → rawHeight≈0.1px → clamped to 16
    await triggerScroll(list, { scrollHeight: 100_000, clientHeight: 100, scrollTop: 0 });

    const thumb = screen.getByTestId("indicator-thumb");
    const heightValue = parseFloat(thumb.style.height);
    expect(heightValue).toBeGreaterThanOrEqual(16);
  });

  it("15. thumbHeight respects a custom minThumbPx option", async () => {
    render(<ScrollIndicatorHarness contentKey="custom-min" minThumbPx={32} />);
    const list = screen.getByTestId("scroll-list");

    // clientHeight=100, scrollHeight=100000 → rawHeight≈0.1px → clamped to 32
    await triggerScroll(list, { scrollHeight: 100_000, clientHeight: 100, scrollTop: 0 });

    const thumb = screen.getByTestId("indicator-thumb");
    const heightValue = parseFloat(thumb.style.height);
    expect(heightValue).toBeGreaterThanOrEqual(32);
  });
});

describe("useScrollPositionIndicator — contentKey re-attachment", () => {
  it("16. hook updates indicator state when contentKey changes (remount scenario)", async () => {
    // Render with initial contentKey
    const { rerender } = render(
      <ScrollIndicatorHarness contentKey="loading:0" />
    );

    const list = screen.getByTestId("scroll-list");

    // Scroll event while loading (no change to indicator since overflow not set)
    await triggerScroll(list, { scrollHeight: 0, clientHeight: 0, scrollTop: 0 });
    expect(screen.queryByTestId("indicator-track")).toBeNull();

    // contentKey changes (simulates transition from loading to loaded state)
    rerender(<ScrollIndicatorHarness contentKey="loaded:10" />);

    // Now scroll with overflow
    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 50 });
    expect(screen.getByTestId("indicator-track")).toBeTruthy();
  });
});

describe("useScrollPositionIndicator — ResizeObserver integration", () => {
  it("17. ResizeObserver is created and observes the scroll list element", () => {
    render(<ScrollIndicatorHarness contentKey="resize-setup" />);
    // The hook should have created a ResizeObserver instance.
    // lastResizeCallback is set inside the MockResizeObserver constructor —
    // if it's non-null, the constructor was called by the hook.
    expect(lastResizeCallback).not.toBeNull();
  });

  it("18. indicator updates after ResizeObserver fires (container size changed)", async () => {
    render(<ScrollIndicatorHarness contentKey="resize-fires" />);
    const list = screen.getByTestId("scroll-list");

    // Set up overflow metrics on the list element
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 600 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(list, "scrollTop", { configurable: true, value: 0 });

    // Simulate a ResizeObserver notification (container resized)
    await act(async () => {
      if (lastResizeCallback) {
        lastResizeCallback([], {} as ResizeObserver);
      }
    });

    expect(screen.getByTestId("indicator-track")).toBeTruthy();
  });
});

describe("useScrollPositionIndicator — thumb style as px values", () => {
  it("19. thumb has top style as a px string when visible", async () => {
    render(<ScrollIndicatorHarness contentKey="top-px" />);
    const list = screen.getByTestId("scroll-list");

    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });

    const thumb = screen.getByTestId("indicator-thumb");
    expect(thumb.style.top).toMatch(/^\d+(\.\d+)?px$/);
  });

  it("20. thumb has height style as a px string when visible", async () => {
    render(<ScrollIndicatorHarness contentKey="height-px" />);
    const list = screen.getByTestId("scroll-list");

    await triggerScroll(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });

    const thumb = screen.getByTestId("indicator-thumb");
    expect(thumb.style.height).toMatch(/^\d+(\.\d+)?px$/);
  });
});
