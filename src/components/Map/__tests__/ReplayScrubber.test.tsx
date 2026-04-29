/**
 * @vitest-environment jsdom
 *
 * Component tests for ReplayScrubber.
 *
 * Verifies that:
 *   1.  Play button is rendered and calls onAtChange when clicked with at=null
 *       (initialises to minAt or fallback start).
 *   2.  Play button renders with correct aria-label.
 *   3.  Pause button appears when isPlaying=true (click play first).
 *   4.  Pause button calls setIsPlaying(false) — stops auto-play interval.
 *   5.  Step-back button is disabled when at=null.
 *   6.  Step-back button advances at backward by stepMs when at is set.
 *   7.  Step-forward button initialises at when at=null.
 *   8.  Step-forward button advances at forward by stepMs.
 *   9.  Speed selector renders all four options: 0.5×, 1×, 2×, 4×.
 *  10.  Speed selector default value is 1×.
 *  11.  Speed selector value changes on option select.
 *  12.  Range slider renders with correct min/max/value when minAt/maxAt provided.
 *  13.  Range slider is disabled when at=null.
 *  14.  Range slider value change calls onAtChange with correct Date.
 *  15.  Live button renders when at is non-null.
 *  16.  Live button is absent when at=null.
 *  17.  Clicking the Live button calls onAtChange(null).
 *  18.  Screen-reader output shows "Live mode" when at=null.
 *  19.  Screen-reader output shows timestamp and speed when playing.
 *  20.  data-replaying attribute is present when at is non-null.
 *  21.  data-playing attribute is present when play is active.
 *  22.  Step-back button clamps to minAt (does not go below minAt).
 *  23.  Step-forward button clamps to maxAt (does not go above maxAt).
 *  24.  Clicking play sets isPlaying and shows pause button.
 *  25.  Transport buttons have correct aria-labels for accessibility.
 *
 * Mocking strategy
 * ────────────────
 * • vi.useFakeTimers — used to control the auto-play interval.
 * • CSS modules stubbed to empty objects via vi.mock.
 * • No external hook mocks needed — ReplayScrubber is self-contained.
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReplayScrubber } from "../ReplayScrubber";

// ─── CSS module stub ──────────────────────────────────────────────────────────

vi.mock("../ReplayScrubber.module.css", () => ({ default: {} }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MIN_AT = new Date("2024-01-01T00:00:00Z");
const MAX_AT = new Date("2024-01-02T00:00:00Z");
const MID_AT = new Date("2024-01-01T12:00:00Z");
const STEP_MS = 5 * 60 * 1000; // 5 minutes

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReplayScrubber", () => {

  // ── Rendering ─────────────────────────────────────────────────────────────

  it("renders the play button when not playing", () => {
    render(
      <ReplayScrubber
        at={null}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const playBtn = screen.getByTestId("scrubber-play");
    expect(playBtn).toBeTruthy();
  });

  it("play button has correct aria-label when at=null", () => {
    render(
      <ReplayScrubber
        at={null}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const playBtn = screen.getByTestId("scrubber-play");
    expect(playBtn.getAttribute("aria-label")).toBe(
      "Start replay from beginning"
    );
  });

  it("play button has correct aria-label when at is set", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const playBtn = screen.getByTestId("scrubber-play");
    expect(playBtn.getAttribute("aria-label")).toBe("Play replay");
  });

  it("renders the step-back button", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    expect(screen.getByTestId("scrubber-step-back")).toBeTruthy();
  });

  it("renders the step-forward button", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    expect(screen.getByTestId("scrubber-step-forward")).toBeTruthy();
  });

  it("renders the range slider", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("scrubber-range")).toBeTruthy();
  });

  it("renders the speed selector", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    expect(screen.getByTestId("scrubber-speed")).toBeTruthy();
  });

  // ── Step-back button ───────────────────────────────────────────────────────

  it("step-back button is disabled when at=null", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    const stepBack = screen.getByTestId("scrubber-step-back");
    expect(stepBack.hasAttribute("disabled")).toBe(true);
  });

  it("step-back button calls onAtChange with at minus stepMs", () => {
    const onAtChange = vi.fn();
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS}
        onAtChange={onAtChange}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-step-back"));

    expect(onAtChange).toHaveBeenCalledOnce();
    const [called] = onAtChange.mock.calls[0] as [Date];
    expect(called.getTime()).toBe(MID_AT.getTime() - STEP_MS);
  });

  it("step-back clamps to minAt", () => {
    const onAtChange = vi.fn();
    const justAfterMin = new Date(MIN_AT.getTime() + 60_000); // 1 minute after minAt

    render(
      <ReplayScrubber
        at={justAfterMin}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS} // 5 min step > 1 min offset → would go below minAt
        onAtChange={onAtChange}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-step-back"));

    const [called] = onAtChange.mock.calls[0] as [Date];
    expect(called.getTime()).toBe(MIN_AT.getTime());
  });

  // ── Step-forward button ────────────────────────────────────────────────────

  it("step-forward button calls onAtChange with at plus stepMs", () => {
    const onAtChange = vi.fn();
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS}
        onAtChange={onAtChange}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-step-forward"));

    expect(onAtChange).toHaveBeenCalledOnce();
    const [called] = onAtChange.mock.calls[0] as [Date];
    expect(called.getTime()).toBe(MID_AT.getTime() + STEP_MS);
  });

  it("step-forward clamps to maxAt", () => {
    const onAtChange = vi.fn();
    const justBeforeMax = new Date(MAX_AT.getTime() - 60_000); // 1 min before maxAt

    render(
      <ReplayScrubber
        at={justBeforeMax}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS} // 5 min step > 1 min remaining → clamps to maxAt
        onAtChange={onAtChange}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-step-forward"));

    const [called] = onAtChange.mock.calls[0] as [Date];
    expect(called.getTime()).toBe(MAX_AT.getTime());
  });

  it("step-forward when at=null initialises to minAt + stepMs", () => {
    const onAtChange = vi.fn();
    render(
      <ReplayScrubber
        at={null}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS}
        onAtChange={onAtChange}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-step-forward"));

    expect(onAtChange).toHaveBeenCalledOnce();
    const [called] = onAtChange.mock.calls[0] as [Date];
    expect(called.getTime()).toBe(MIN_AT.getTime() + STEP_MS);
  });

  // ── Speed selector ─────────────────────────────────────────────────────────

  it("speed selector renders four options: 0.5×, 1×, 2×, 4×", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    const select = screen.getByTestId("scrubber-speed") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.text);

    expect(options).toContain("0.5×");
    expect(options).toContain("1×");
    expect(options).toContain("2×");
    expect(options).toContain("4×");
    expect(options).toHaveLength(4);
  });

  it("speed selector defaults to 1×", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    const select = screen.getByTestId("scrubber-speed") as HTMLSelectElement;
    expect(select.value).toBe("1");
  });

  it("speed selector value updates when option is changed", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    const select = screen.getByTestId("scrubber-speed") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2" } });

    expect(select.value).toBe("2");
  });

  it("speed selector accepts 0.5× option", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    const select = screen.getByTestId("scrubber-speed") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "0.5" } });

    expect(select.value).toBe("0.5");
  });

  // ── Range slider ───────────────────────────────────────────────────────────

  it("range slider is disabled when at=null", () => {
    render(
      <ReplayScrubber
        at={null}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const range = screen.getByTestId("scrubber-range") as HTMLInputElement;
    expect(range.disabled).toBe(true);
  });

  it("range slider is enabled when at is set and minAt is provided", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const range = screen.getByTestId("scrubber-range") as HTMLInputElement;
    expect(range.disabled).toBe(false);
  });

  it("range slider min/max match minAt/maxAt in milliseconds", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS}
        onAtChange={vi.fn()}
      />
    );

    const range = screen.getByTestId("scrubber-range") as HTMLInputElement;
    expect(Number(range.min)).toBe(MIN_AT.getTime());
    expect(Number(range.max)).toBe(MAX_AT.getTime());
  });

  it("range slider value matches at.getTime()", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const range = screen.getByTestId("scrubber-range") as HTMLInputElement;
    expect(Number(range.value)).toBe(MID_AT.getTime());
  });

  it("range slider change calls onAtChange with the correct Date", () => {
    const onAtChange = vi.fn();
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS}
        onAtChange={onAtChange}
      />
    );

    const targetTs = MIN_AT.getTime() + 2 * STEP_MS;
    const range = screen.getByTestId("scrubber-range");
    fireEvent.change(range, { target: { value: String(targetTs) } });

    expect(onAtChange).toHaveBeenCalledOnce();
    const [called] = onAtChange.mock.calls[0] as [Date];
    expect(called.getTime()).toBe(targetTs);
  });

  // ── Live button ────────────────────────────────────────────────────────────

  it("live button is not rendered when at=null", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    expect(screen.queryByTestId("scrubber-live")).toBeNull();
  });

  it("live button is rendered when at is non-null", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("scrubber-live")).toBeTruthy();
  });

  it("clicking the live button calls onAtChange(null)", () => {
    const onAtChange = vi.fn();
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={onAtChange}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-live"));

    expect(onAtChange).toHaveBeenCalledOnce();
    expect(onAtChange).toHaveBeenCalledWith(null);
  });

  // ── Play / Pause ───────────────────────────────────────────────────────────

  it("clicking play shows the pause button", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    expect(screen.queryByTestId("scrubber-pause")).toBeNull();

    fireEvent.click(screen.getByTestId("scrubber-play"));

    expect(screen.getByTestId("scrubber-pause")).toBeTruthy();
    expect(screen.queryByTestId("scrubber-play")).toBeNull();
  });

  it("clicking pause returns to the play button", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-play"));
    expect(screen.getByTestId("scrubber-pause")).toBeTruthy();

    fireEvent.click(screen.getByTestId("scrubber-pause"));
    expect(screen.getByTestId("scrubber-play")).toBeTruthy();
    expect(screen.queryByTestId("scrubber-pause")).toBeNull();
  });

  it("clicking play with at=null initialises at to minAt via onAtChange", () => {
    const onAtChange = vi.fn();
    render(
      <ReplayScrubber
        at={null}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={onAtChange}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-play"));

    expect(onAtChange).toHaveBeenCalledOnce();
    const [called] = onAtChange.mock.calls[0] as [Date];
    expect(called.getTime()).toBe(MIN_AT.getTime());
  });

  it("step-back while playing pauses playback (shows play button)", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS}
        onAtChange={vi.fn()}
      />
    );

    // Start playing
    fireEvent.click(screen.getByTestId("scrubber-play"));
    expect(screen.getByTestId("scrubber-pause")).toBeTruthy();

    // Step back — should pause
    fireEvent.click(screen.getByTestId("scrubber-step-back"));
    expect(screen.getByTestId("scrubber-play")).toBeTruthy();
    expect(screen.queryByTestId("scrubber-pause")).toBeNull();
  });

  it("step-forward while playing pauses playback (shows play button)", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS}
        onAtChange={vi.fn()}
      />
    );

    // Start playing
    fireEvent.click(screen.getByTestId("scrubber-play"));
    expect(screen.getByTestId("scrubber-pause")).toBeTruthy();

    // Step forward — should pause
    fireEvent.click(screen.getByTestId("scrubber-step-forward"));
    expect(screen.getByTestId("scrubber-play")).toBeTruthy();
    expect(screen.queryByTestId("scrubber-pause")).toBeNull();
  });

  // ── Auto-play interval ─────────────────────────────────────────────────────

  it("auto-play calls onAtChange after one tick interval", () => {
    vi.useFakeTimers();
    const onAtChange = vi.fn();

    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS}
        onAtChange={onAtChange}
      />
    );

    // Start playing
    act(() => {
      fireEvent.click(screen.getByTestId("scrubber-play"));
    });

    // Advance 1 second (one tick)
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // onAtChange should have been called: once for play init (at was set),
    // then once per tick.  At least one tick call at MID_AT + STEP_MS * 1.
    const calls = onAtChange.mock.calls as [Date][];
    const tickCalls = calls.filter(
      ([d]) => d.getTime() > MID_AT.getTime()
    );
    expect(tickCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("auto-play respects the selected speed multiplier", () => {
    vi.useFakeTimers();
    const onAtChange = vi.fn();

    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        stepMs={STEP_MS}
        onAtChange={onAtChange}
      />
    );

    // Set speed to 2×
    const speedSelect = screen.getByTestId("scrubber-speed");
    act(() => {
      fireEvent.change(speedSelect, { target: { value: "2" } });
    });

    // Start playing
    act(() => {
      fireEvent.click(screen.getByTestId("scrubber-play"));
    });

    // Advance 1 tick
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // The tick should have advanced by STEP_MS * 2 (speed 2×)
    const calls = onAtChange.mock.calls as [Date][];
    const tickCalls = calls.filter(
      ([d]) => d.getTime() >= MID_AT.getTime() + STEP_MS * 2
    );
    expect(tickCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── data attributes ────────────────────────────────────────────────────────

  it("data-replaying is present when at is non-null", () => {
    const { container } = render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const root = container.querySelector("[data-replaying='true']");
    expect(root).not.toBeNull();
  });

  it("data-replaying is absent when at=null", () => {
    const { container } = render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    const root = container.querySelector("[data-replaying='true']");
    expect(root).toBeNull();
  });

  it("data-playing is present after play is clicked", () => {
    const { container } = render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-play"));

    const root = container.querySelector("[data-playing='true']");
    expect(root).not.toBeNull();
  });

  it("data-playing is absent before play is clicked", () => {
    const { container } = render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const root = container.querySelector("[data-playing='true']");
    expect(root).toBeNull();
  });

  // ── Screen-reader output ───────────────────────────────────────────────────

  it("status output shows 'Live mode' when at=null", () => {
    render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    const output = screen.getByTestId("scrubber-status");
    expect(output.textContent).toContain("Live mode");
  });

  it("status output shows timestamp when at is set and paused", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const output = screen.getByTestId("scrubber-status");
    expect(output.textContent).toContain("paused");
  });

  it("status output mentions speed when playing", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("scrubber-play"));

    const output = screen.getByTestId("scrubber-status");
    expect(output.textContent).toContain("playing");
    expect(output.textContent).toContain("1×");
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it("step-back button has aria-label 'Step back one step'", () => {
    render(<ReplayScrubber at={null} onAtChange={vi.fn()} />);

    const btn = screen.getByTestId("scrubber-step-back");
    expect(btn.getAttribute("aria-label")).toBe("Step back one step");
  });

  it("step-forward button has aria-label 'Step forward one step'", () => {
    render(<ReplayScrubber at={null} onAtChange={vi.fn()} />);

    const btn = screen.getByTestId("scrubber-step-forward");
    expect(btn.getAttribute("aria-label")).toBe("Step forward one step");
  });

  it("speed selector has aria-label 'Playback speed'", () => {
    render(<ReplayScrubber at={null} onAtChange={vi.fn()} />);

    const select = screen.getByTestId("scrubber-speed");
    expect(select.getAttribute("aria-label")).toBe("Playback speed");
  });

  it("range slider has aria-label 'Replay timeline position'", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const range = screen.getByTestId("scrubber-range");
    expect(range.getAttribute("aria-label")).toBe("Replay timeline position");
  });

  it("live button has aria-label that mentions 'Return to live view'", () => {
    render(
      <ReplayScrubber
        at={MID_AT}
        minAt={MIN_AT}
        maxAt={MAX_AT}
        onAtChange={vi.fn()}
      />
    );

    const liveBtn = screen.getByTestId("scrubber-live");
    expect(liveBtn.getAttribute("aria-label")).toContain("Return to live view");
  });

  it("root element has role='group' with aria-label", () => {
    const { container } = render(
      <ReplayScrubber at={null} onAtChange={vi.fn()} />
    );

    const root = container.querySelector("[role='group']");
    expect(root).not.toBeNull();
    expect(root!.getAttribute("aria-label")).toBe("Replay scrubber controls");
  });
});
