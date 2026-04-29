/**
 * @vitest-environment jsdom
 *
 * src/hooks/__tests__/use-playback-engine.test.ts
 *
 * Unit tests for usePlaybackEngine — stop-index playback engine.
 *
 * The tests cover:
 *
 * Initialisation
 *   1.  Returns activeStopIndex = 0 on first render (default initialIndex).
 *   2.  Accepts a custom initialIndex and clamps it to valid range.
 *   3.  isPlaying is false on first render.
 *   4.  isAtEnd is false when stopCount > 1.
 *   5.  isAtEnd is false when stopCount = 0.
 *   6.  isAtEnd is true when stopCount = 1 (only one stop → already at end).
 *
 * play / pause
 *   7.  play() sets isPlaying to true.
 *   8.  pause() sets isPlaying to false.
 *   9.  play() is a no-op when stopCount = 0.
 *  10.  pause() is idempotent (calling twice stays paused).
 *
 * stepForward
 *  11.  stepForward() increments activeStopIndex by 1.
 *  12.  stepForward() pauses playback.
 *  13.  stepForward() clamps to stopCount - 1 (last stop).
 *  14.  stepForward() is a no-op when stopCount = 0.
 *
 * stepBack
 *  15.  stepBack() decrements activeStopIndex by 1.
 *  16.  stepBack() pauses playback.
 *  17.  stepBack() clamps to 0 (first stop).
 *  18.  stepBack() is a no-op when stopCount = 0.
 *
 * setStopIndex
 *  19.  setStopIndex() jumps to a specific index.
 *  20.  setStopIndex() clamps below 0 to 0.
 *  21.  setStopIndex() clamps above stopCount - 1 to stopCount - 1.
 *  22.  setStopIndex() does not change isPlaying.
 *  23.  setStopIndex() is a no-op when stopCount = 0.
 *
 * reset
 *  24.  reset() sets activeStopIndex to 0.
 *  25.  reset() sets isPlaying to false.
 *  26.  reset() is a no-op when stopCount = 0.
 *
 * Timer-driven playback (fake timers)
 *  27.  After one tick the index advances by 1 at 1× speed.
 *  28.  After two ticks the index advances by 2 at 1× speed.
 *  29.  Auto-pauses at the last stop (isPlaying becomes false).
 *  30.  activeStopIndex is clamped to stopCount - 1 (never exceeds last).
 *  31.  At 2× speed the tick fires twice as fast (500 ms interval).
 *  32.  At 0.5× speed the tick fires half as fast (2 000 ms interval).
 *  33.  At 4× speed the tick fires four times as fast (250 ms interval).
 *  34.  Speed change restarts the interval at the new rate.
 *  35.  Pausing mid-playback stops the timer; no further advances.
 *  36.  isAtEnd becomes true once the engine reaches the last stop.
 *
 * Stability / edge cases
 *  37.  No timer fires when isPlaying = false.
 *  38.  stepForward while playing pauses playback.
 *  39.  stepBack while playing pauses playback.
 *  40.  Mounting with stopCount = 0 is stable (no errors, no timer).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePlaybackEngine } from "../use-playback-engine";

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Render the hook with a fixed stopCount and default options. */
function renderEngine(stopCount: number, opts?: Partial<Parameters<typeof usePlaybackEngine>[0]>) {
  return renderHook(() =>
    usePlaybackEngine({ stopCount, ...opts })
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("usePlaybackEngine — initialisation", () => {

  it("1. returns activeStopIndex = 0 on first render by default", () => {
    const { result } = renderEngine(5);
    expect(result.current.activeStopIndex).toBe(0);
  });

  it("2. accepts a custom initialIndex", () => {
    const { result } = renderEngine(5, { initialIndex: 3 });
    expect(result.current.activeStopIndex).toBe(3);
  });

  it("2b. clamps initialIndex above stopCount - 1", () => {
    const { result } = renderEngine(3, { initialIndex: 99 });
    expect(result.current.activeStopIndex).toBe(2);
  });

  it("2c. clamps initialIndex below 0", () => {
    const { result } = renderEngine(3, { initialIndex: -5 });
    expect(result.current.activeStopIndex).toBe(0);
  });

  it("3. isPlaying is false on first render", () => {
    const { result } = renderEngine(5);
    expect(result.current.isPlaying).toBe(false);
  });

  it("4. isAtEnd is false when stopCount > 1 and index is 0", () => {
    const { result } = renderEngine(5);
    expect(result.current.isAtEnd).toBe(false);
  });

  it("5. isAtEnd is false when stopCount = 0", () => {
    const { result } = renderEngine(0);
    expect(result.current.isAtEnd).toBe(false);
  });

  it("6. isAtEnd is true when stopCount = 1 (only one stop)", () => {
    const { result } = renderEngine(1);
    // stopCount = 1 → last index = 0 → activeStopIndex starts at 0 → isAtEnd = true
    expect(result.current.isAtEnd).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("usePlaybackEngine — play / pause", () => {

  it("7. play() sets isPlaying to true", () => {
    const { result } = renderEngine(5);
    act(() => result.current.play());
    expect(result.current.isPlaying).toBe(true);
  });

  it("8. pause() sets isPlaying to false", () => {
    const { result } = renderEngine(5);
    act(() => { result.current.play(); });
    act(() => { result.current.pause(); });
    expect(result.current.isPlaying).toBe(false);
  });

  it("9. play() is a no-op when stopCount = 0", () => {
    const { result } = renderEngine(0);
    act(() => result.current.play());
    expect(result.current.isPlaying).toBe(false);
  });

  it("10. pause() is idempotent — calling twice stays paused", () => {
    const { result } = renderEngine(5);
    act(() => { result.current.pause(); });
    act(() => { result.current.pause(); });
    expect(result.current.isPlaying).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("usePlaybackEngine — stepForward", () => {

  it("11. stepForward() increments activeStopIndex by 1", () => {
    const { result } = renderEngine(5);
    act(() => result.current.stepForward());
    expect(result.current.activeStopIndex).toBe(1);
  });

  it("12. stepForward() pauses playback", () => {
    const { result } = renderEngine(5);
    act(() => { result.current.play(); });
    act(() => { result.current.stepForward(); });
    expect(result.current.isPlaying).toBe(false);
  });

  it("13. stepForward() clamps to stopCount - 1 at the last stop", () => {
    const { result } = renderEngine(3, { initialIndex: 2 }); // already at last
    act(() => result.current.stepForward());
    expect(result.current.activeStopIndex).toBe(2); // still 2 (last)
  });

  it("14. stepForward() is a no-op when stopCount = 0", () => {
    const { result } = renderEngine(0);
    act(() => result.current.stepForward());
    expect(result.current.activeStopIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("usePlaybackEngine — stepBack", () => {

  it("15. stepBack() decrements activeStopIndex by 1", () => {
    const { result } = renderEngine(5, { initialIndex: 3 });
    act(() => result.current.stepBack());
    expect(result.current.activeStopIndex).toBe(2);
  });

  it("16. stepBack() pauses playback", () => {
    const { result } = renderEngine(5, { initialIndex: 3 });
    act(() => { result.current.play(); });
    act(() => { result.current.stepBack(); });
    expect(result.current.isPlaying).toBe(false);
  });

  it("17. stepBack() clamps to 0 at the first stop", () => {
    const { result } = renderEngine(5, { initialIndex: 0 });
    act(() => result.current.stepBack());
    expect(result.current.activeStopIndex).toBe(0);
  });

  it("18. stepBack() is a no-op when stopCount = 0", () => {
    const { result } = renderEngine(0);
    act(() => result.current.stepBack());
    expect(result.current.activeStopIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("usePlaybackEngine — setStopIndex", () => {

  it("19. setStopIndex() jumps to a specific index", () => {
    const { result } = renderEngine(10);
    act(() => result.current.setStopIndex(7));
    expect(result.current.activeStopIndex).toBe(7);
  });

  it("20. setStopIndex() clamps values below 0 to 0", () => {
    const { result } = renderEngine(5);
    act(() => result.current.setStopIndex(-3));
    expect(result.current.activeStopIndex).toBe(0);
  });

  it("21. setStopIndex() clamps values above stopCount - 1", () => {
    const { result } = renderEngine(5);
    act(() => result.current.setStopIndex(50));
    expect(result.current.activeStopIndex).toBe(4);
  });

  it("22. setStopIndex() does not change isPlaying", () => {
    const { result } = renderEngine(10);
    // Still paused
    act(() => result.current.setStopIndex(5));
    expect(result.current.isPlaying).toBe(false);

    // Now playing
    act(() => { result.current.play(); });
    act(() => result.current.setStopIndex(3));
    expect(result.current.isPlaying).toBe(true);
  });

  it("23. setStopIndex() is a no-op when stopCount = 0", () => {
    const { result } = renderEngine(0);
    act(() => result.current.setStopIndex(5));
    expect(result.current.activeStopIndex).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("usePlaybackEngine — reset", () => {

  it("24. reset() sets activeStopIndex to 0", () => {
    const { result } = renderEngine(5, { initialIndex: 4 });
    act(() => result.current.reset());
    expect(result.current.activeStopIndex).toBe(0);
  });

  it("25. reset() sets isPlaying to false", () => {
    const { result } = renderEngine(5);
    act(() => { result.current.play(); });
    act(() => { result.current.reset(); });
    expect(result.current.isPlaying).toBe(false);
  });

  it("26. reset() is a no-op when stopCount = 0", () => {
    const { result } = renderEngine(0);
    act(() => result.current.reset());
    expect(result.current.activeStopIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("usePlaybackEngine — timer-driven playback", () => {

  it("27. advances by 1 after one tick at 1× speed (1000 ms)", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(10, { speed: 1 });

    act(() => { result.current.play(); });

    // Advance exactly one tick
    act(() => { vi.advanceTimersByTime(1_000); });

    expect(result.current.activeStopIndex).toBe(1);
  });

  it("28. advances by 2 after two ticks at 1× speed (2000 ms)", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(10, { speed: 1 });

    act(() => { result.current.play(); });
    act(() => { vi.advanceTimersByTime(2_000); });

    expect(result.current.activeStopIndex).toBe(2);
  });

  it("29. auto-pauses when the last stop is reached", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(3, { speed: 1 }); // stops: 0, 1, 2

    act(() => { result.current.play(); });

    // Advance past the last stop (3 ticks for 3 stops, but we only have 2 more)
    act(() => { vi.advanceTimersByTime(5_000); }); // 5 ticks

    // Should be at the last stop (index 2) and paused
    expect(result.current.activeStopIndex).toBe(2);
    expect(result.current.isPlaying).toBe(false);
  });

  it("30. activeStopIndex never exceeds stopCount - 1", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(3, { speed: 1 });

    act(() => { result.current.play(); });
    act(() => { vi.advanceTimersByTime(10_000); }); // many ticks

    expect(result.current.activeStopIndex).toBeLessThanOrEqual(2);
  });

  it("31. at 2× speed, the tick fires every 500 ms", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(10, { speed: 2 });

    act(() => { result.current.play(); });

    // After 500 ms at 2× → 1 tick
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.activeStopIndex).toBe(1);

    // After another 500 ms → 2nd tick
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.activeStopIndex).toBe(2);
  });

  it("32. at 0.5× speed, the tick fires every 2000 ms", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(10, { speed: 0.5 });

    act(() => { result.current.play(); });

    // After 1000 ms at 0.5× → no tick yet
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.activeStopIndex).toBe(0);

    // After another 1000 ms (total 2000 ms) → 1 tick fires
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.activeStopIndex).toBe(1);
  });

  it("33. at 4× speed, the tick fires every 250 ms", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(10, { speed: 4 });

    act(() => { result.current.play(); });

    // After 250 ms → 1 tick
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current.activeStopIndex).toBe(1);

    // After another 250 ms → 2nd tick
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current.activeStopIndex).toBe(2);
  });

  it("35. pausing mid-playback stops the timer; no further advances", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(10, { speed: 1 });

    act(() => { result.current.play(); });
    act(() => { vi.advanceTimersByTime(2_000); }); // advance 2 stops

    const indexAfterTwoTicks = result.current.activeStopIndex;
    expect(indexAfterTwoTicks).toBe(2);

    act(() => { result.current.pause(); });

    // Advance more time — index must not change since we are paused
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current.activeStopIndex).toBe(indexAfterTwoTicks);
    expect(result.current.isPlaying).toBe(false);
  });

  it("36. isAtEnd becomes true once the engine reaches the last stop", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(3, { speed: 1 }); // indices 0, 1, 2

    act(() => { result.current.play(); });

    // Not at end yet
    expect(result.current.isAtEnd).toBe(false);

    // Advance to the last stop
    act(() => { vi.advanceTimersByTime(2_000); }); // 2 ticks → index 2

    expect(result.current.activeStopIndex).toBe(2);
    expect(result.current.isAtEnd).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("usePlaybackEngine — stability / edge cases", () => {

  it("37. no timer fires when isPlaying = false", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(10);

    // Do NOT call play()
    act(() => { vi.advanceTimersByTime(5_000); });

    expect(result.current.activeStopIndex).toBe(0);
  });

  it("38. stepForward while playing pauses playback", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(10, { speed: 1 });

    act(() => { result.current.play(); });
    expect(result.current.isPlaying).toBe(true);

    act(() => { result.current.stepForward(); });
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.activeStopIndex).toBe(1);
  });

  it("39. stepBack while playing pauses playback", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(10, { speed: 1, initialIndex: 3 });

    act(() => { result.current.play(); });
    expect(result.current.isPlaying).toBe(true);

    act(() => { result.current.stepBack(); });
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.activeStopIndex).toBe(2);
  });

  it("40. mounting with stopCount = 0 is stable — no errors, no timer", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(0);

    // All actions should be no-ops
    act(() => { result.current.play(); });
    act(() => { result.current.stepForward(); });
    act(() => { result.current.stepBack(); });
    act(() => { result.current.setStopIndex(5); });
    act(() => { result.current.reset(); });
    act(() => { vi.advanceTimersByTime(5_000); });

    expect(result.current.activeStopIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isAtEnd).toBe(false);
  });

  it("isAtEnd updates when setStopIndex reaches the last stop", () => {
    const { result } = renderEngine(5);

    expect(result.current.isAtEnd).toBe(false);

    act(() => result.current.setStopIndex(4)); // last index for stopCount=5

    expect(result.current.isAtEnd).toBe(true);
    expect(result.current.activeStopIndex).toBe(4);
  });

  it("isAtEnd becomes false again after reset", () => {
    const { result } = renderEngine(5, { initialIndex: 4 });

    expect(result.current.isAtEnd).toBe(true);

    act(() => result.current.reset());

    expect(result.current.isAtEnd).toBe(false);
    expect(result.current.activeStopIndex).toBe(0);
  });

  it("play after reaching end via timer stays at last stop (does not wrap around)", () => {
    vi.useFakeTimers();
    const { result } = renderEngine(3, { speed: 1 }); // indices 0,1,2

    // Play through all stops
    act(() => { result.current.play(); });
    act(() => { vi.advanceTimersByTime(10_000); }); // well past end

    expect(result.current.activeStopIndex).toBe(2);
    expect(result.current.isPlaying).toBe(false);

    // Play again from the end — immediately auto-pauses (already at last stop)
    act(() => { result.current.play(); });
    act(() => { vi.advanceTimersByTime(1_000); });

    // Should still be at the last stop, paused
    expect(result.current.activeStopIndex).toBe(2);
    expect(result.current.isPlaying).toBe(false);
  });
});
