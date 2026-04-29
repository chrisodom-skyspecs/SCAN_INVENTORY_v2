/**
 * src/hooks/use-playback-engine.ts
 *
 * usePlaybackEngine — stop-index playback engine for the INVENTORY
 * journey-stop replay experience.
 *
 * Overview
 * ────────
 * Manages an "active stop index" that steps through a fixed-length array of
 * journey stops one position at a time.  Playback is timer-driven: an
 * internal interval fires at a rate derived from the `speed` multiplier
 * and advances the index by 1 on each tick.  When the index reaches the last
 * stop, playback auto-pauses so the user can review the final state without
 * the loop resetting.
 *
 * This hook is the engine beneath the journey-replay UI.  It is data-agnostic:
 * it only tracks a numeric index; the caller maps that index to the actual
 * journey stop objects from `useM2JourneyStops` / `useJourneyStopLayer`.
 *
 * Tick rate
 * ─────────
 * The base tick interval is 1 000 ms (one stop per second at 1 ×).
 * The actual interval duration is `BASE_TICK_MS / speed`:
 *
 *   speed | interval | stops/sec
 *   ──────┼──────────┼──────────
 *   0.5 × │  2 000 ms │   0.5
 *   1 ×   │  1 000 ms │   1.0
 *   2 ×   │    500 ms │   2.0
 *   4 ×   │    250 ms │   4.0
 *
 * Speed changes restart the interval immediately so the new rate takes
 * effect without waiting for the current tick to fire.
 *
 * Auto-pause
 * ──────────
 * When the incremented index would exceed the last stop (stopCount - 1),
 * the index is clamped to the last stop and `isPlaying` is set to false.
 * This matches the behaviour expected by the UI: the user sees the final
 * stop highlighted and can press play again to stay at the end or use
 * `reset()` to return to the beginning.
 *
 * Stale-closure safety
 * ────────────────────
 * The interval callback reads current values through refs (same pattern
 * used in ReplayScrubber.tsx) so changing `stopCount` or `speed` does not
 * leave stale data inside the closure.  `activeStopIndex` is read via
 * `activeIndexRef.current`; `stopCount` via `stopCountRef.current`.
 *
 * Usage
 * ─────
 * ```tsx
 * function JourneyReplayPanel({ stops }: { stops: JourneyStop[] }) {
 *   const {
 *     activeStopIndex,
 *     isPlaying,
 *     isAtEnd,
 *     play,
 *     pause,
 *     stepForward,
 *     stepBack,
 *     setStopIndex,
 *     reset,
 *   } = usePlaybackEngine({ stopCount: stops.length, speed });
 *
 *   return (
 *     <>
 *       <StopMarker stop={stops[activeStopIndex]} />
 *       <button onClick={isPlaying ? pause : play}>
 *         {isPlaying ? "Pause" : "Play"}
 *       </button>
 *     </>
 *   );
 * }
 * ```
 *
 * Edge cases
 * ──────────
 * • stopCount = 0  — all actions are no-ops; activeStopIndex stays at 0.
 * • stopCount = 1  — play immediately auto-pauses after the first tick
 *                    (already at the last stop on mount).
 * • speed changes  — the effect re-runs and a fresh interval is installed;
 *                    the index is not reset.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Supported playback speed multipliers.  Matches ReplayScrubber.PlaybackSpeed. */
export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export interface UsePlaybackEngineOptions {
  /**
   * Total number of stops to step through.
   * The valid index range is [0, stopCount - 1].
   * When 0, all actions are no-ops.
   */
  stopCount: number;

  /**
   * Playback speed multiplier.  Controls the tick rate.
   * At 1 ×: one stop per second.  At 2 ×: two stops per second. etc.
   * @default 1
   */
  speed?: PlaybackSpeed;

  /**
   * Initial active stop index (0-based).
   * Must be within [0, stopCount - 1]; clamped automatically.
   * @default 0
   */
  initialIndex?: number;
}

export interface UsePlaybackEngineResult {
  /**
   * The index of the currently "active" journey stop (0-based).
   * Always in range [0, stopCount - 1].  0 when stopCount = 0.
   */
  activeStopIndex: number;

  /**
   * True when the timer-driven playback is running.
   */
  isPlaying: boolean;

  /**
   * True when activeStopIndex is at the last stop (stopCount - 1).
   * Always false when stopCount = 0.
   */
  isAtEnd: boolean;

  /**
   * Start timer-driven playback from the current position.
   * If already at the last stop, playback auto-pauses on the first tick.
   * No-op when stopCount = 0.
   */
  play: () => void;

  /**
   * Pause timer-driven playback.  The current index is preserved.
   */
  pause: () => void;

  /**
   * Advance the active index by 1 and pause playback.
   * Clamped to stopCount - 1.  No-op when stopCount = 0.
   */
  stepForward: () => void;

  /**
   * Rewind the active index by 1 and pause playback.
   * Clamped to 0.  No-op when stopCount = 0.
   */
  stepBack: () => void;

  /**
   * Jump to a specific stop index (0-based).
   * Value is clamped to [0, stopCount - 1].
   * Does NOT automatically start or stop playback.
   */
  setStopIndex: (index: number) => void;

  /**
   * Reset to the first stop (index 0) and stop playback.
   * No-op when stopCount = 0.
   */
  reset: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Base tick interval in ms at 1 × speed. */
const BASE_TICK_MS = 1_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * usePlaybackEngine
 *
 * Stop-index playback engine.  Manages an active stop index that advances
 * on a timer, respects a speed multiplier, and auto-pauses at the last stop.
 *
 * @param options  { stopCount, speed?, initialIndex? }
 * @returns        UsePlaybackEngineResult
 */
export function usePlaybackEngine({
  stopCount,
  speed = 1,
  initialIndex = 0,
}: UsePlaybackEngineOptions): UsePlaybackEngineResult {
  // ── State ────────────────────────────────────────────────────────────────────

  // Clamp initialIndex to a valid range on first render.
  const clampedInitial =
    stopCount > 0 ? Math.max(0, Math.min(initialIndex, stopCount - 1)) : 0;

  const [activeStopIndex, setActiveStopIndex] = useState<number>(clampedInitial);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // ── Refs (stale-closure safety) ───────────────────────────────────────────

  /**
   * Ref to the current activeStopIndex.
   * The interval closure reads this instead of the captured state variable
   * so it always sees the latest index without needing to re-register the
   * interval on every state change.
   */
  const activeIndexRef = useRef<number>(clampedInitial);
  activeIndexRef.current = activeStopIndex;

  /**
   * Ref to the current stopCount.
   * Allows the interval to check whether we've reached the end even when
   * stopCount changes after the interval was registered.
   */
  const stopCountRef = useRef<number>(stopCount);
  stopCountRef.current = stopCount;

  // ── Derived values ────────────────────────────────────────────────────────

  const isAtEnd = stopCount > 0 && activeStopIndex >= stopCount - 1;

  // ── Playback interval ─────────────────────────────────────────────────────
  //
  // The interval fires every (BASE_TICK_MS / speed) ms and advances the index
  // by 1.  It is created / destroyed by this effect whenever `isPlaying` or
  // `speed` changes.  When the index reaches the last stop the interval is
  // cleared and `isPlaying` is set to false (auto-pause).
  useEffect(() => {
    // Do not install an interval when paused or when there are no stops.
    if (!isPlaying || stopCount === 0) return;

    const intervalMs = BASE_TICK_MS / speed;

    const id = setInterval(() => {
      const current = activeIndexRef.current;
      const total   = stopCountRef.current;

      if (total === 0) {
        // Guard: stopCount became 0 while playing (unlikely but safe).
        setIsPlaying(false);
        clearInterval(id);
        return;
      }

      const lastIndex = total - 1;

      if (current >= lastIndex) {
        // Already at end — auto-pause without advancing.
        setIsPlaying(false);
        return;
      }

      const next = current + 1;
      activeIndexRef.current = next;
      setActiveStopIndex(next);

      // Auto-pause when we just reached the last stop.
      if (next >= lastIndex) {
        setIsPlaying(false);
      }
    }, intervalMs);

    return () => clearInterval(id);
    // Intentionally omitting `stopCount` from deps — stopCountRef keeps it fresh.
    // We only want the interval to be recreated when isPlaying or speed changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, speed]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /** Start timer-driven playback. */
  const play = useCallback(() => {
    if (stopCountRef.current === 0) return;
    setIsPlaying(true);
  }, []);

  /** Pause timer-driven playback. */
  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  /** Advance by 1 stop and pause. */
  const stepForward = useCallback(() => {
    const total = stopCountRef.current;
    if (total === 0) return;

    setIsPlaying(false);
    setActiveStopIndex((prev) => {
      const next = Math.min(prev + 1, total - 1);
      activeIndexRef.current = next;
      return next;
    });
  }, []);

  /** Rewind by 1 stop and pause. */
  const stepBack = useCallback(() => {
    const total = stopCountRef.current;
    if (total === 0) return;

    setIsPlaying(false);
    setActiveStopIndex((prev) => {
      const next = Math.max(prev - 1, 0);
      activeIndexRef.current = next;
      return next;
    });
  }, []);

  /**
   * Jump to a specific stop index (0-based).
   * Clamped to [0, stopCount - 1].  Does not change isPlaying.
   */
  const setStopIndex = useCallback((index: number) => {
    const total = stopCountRef.current;
    if (total === 0) return;

    const clamped = Math.max(0, Math.min(index, total - 1));
    activeIndexRef.current = clamped;
    setActiveStopIndex(clamped);
  }, []);

  /** Reset to the first stop and stop playback. */
  const reset = useCallback(() => {
    if (stopCountRef.current === 0) return;
    setIsPlaying(false);
    activeIndexRef.current = 0;
    setActiveStopIndex(0);
  }, []);

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    activeStopIndex,
    isPlaying,
    isAtEnd,
    play,
    pause,
    stepForward,
    stepBack,
    setStopIndex,
    reset,
  };
}

export default usePlaybackEngine;
