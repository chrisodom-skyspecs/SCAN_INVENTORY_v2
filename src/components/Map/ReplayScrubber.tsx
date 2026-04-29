/**
 * ReplayScrubber — Replay timeline control for M2 (and optionally M5) map toolbar
 *
 * Provides play/pause, step-forward, step-back controls, a speed selector
 * (0.5×/1×/2×/4×), and a range slider for visual scrubbing across a time window.
 *
 * State management
 * ────────────────
 * The component owns:
 *   • isPlaying      — whether auto-play is running
 *   • playbackSpeed  — selected speed multiplier
 *
 * The caller owns:
 *   • at             — current replay timestamp (null = live / no replay)
 *   • minAt / maxAt  — time window bounds (used to clamp step + range slider)
 *   • onAtChange     — callback fired whenever the position changes
 *
 * Auto-play behaviour
 * ───────────────────
 * When playing, a 1-second interval fires and advances `at` by
 * `stepMs × speed` milliseconds.  When `at` reaches `maxAt` (or Date.now()
 * when maxAt is not provided), playback stops automatically and the
 * component returns to paused state.
 *
 * If `at` is null when play is pressed, it is initialised to `minAt`
 * (or `Date.now() − 1 hour` as a fallback) so playback can begin
 * immediately without requiring the user to set a start time first.
 *
 * Step behaviour
 * ──────────────
 * Step-forward / step-back advance or rewind `at` by `stepMs` (default 5
 * minutes = 300 000 ms), clamped to [minAt, maxAt].  Speed is not applied
 * to step buttons — each click always moves exactly one step.
 *
 * Range slider
 * ────────────
 * An `<input type="range">` maps [minAt, maxAt] to a numeric range.
 * Dragging the thumb calls `onAtChange` in real-time.  The slider is
 * disabled while `at` is null (live mode) or when minAt/maxAt are absent.
 *
 * Accessibility
 * ─────────────
 * • Play/pause/step buttons have descriptive aria-labels.
 * • Speed select has an aria-label; the current speed is communicated via
 *   the selected option.
 * • Range input has aria-label and aria-valuetext showing the formatted time.
 * • An `<output>` element with aria-live="polite" announces position changes
 *   to screen readers.
 * • All interactive elements meet WCAG AA focus-visible contrast.
 *
 * Design tokens
 * ─────────────
 * All colours via CSS custom properties (no hex literals).  Key tokens:
 *   --map-m5-scrubber-fill   : progress fill / play button accent
 *   --map-m5-scrubber-thumb  : range thumb
 *   --map-m5-scrubber-track  : range track background
 *   --surface-*              : backgrounds
 *   --ink-*                  : text / icon colors
 *   --border-*               : button borders
 *
 * Typography: Inter Tight for labels, IBM Plex Mono for timestamp values.
 */

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import styles from "./ReplayScrubber.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Supported playback speed multipliers. */
export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export interface ReplayScrubberProps {
  /**
   * Current replay position.  null = live mode (no scrubbing active).
   * This prop is controlled — the parent is responsible for persisting it
   * (e.g. via useMapParams setAt).
   */
  at: Date | null;
  /**
   * Earliest timestamp available for scrubbing.
   * Used as the range slider minimum and the step-back clamp.
   */
  minAt?: Date;
  /**
   * Latest timestamp available for scrubbing.
   * Defaults to the current wall-clock time when not supplied.
   * Used as the range slider maximum and the step-forward / auto-play clamp.
   */
  maxAt?: Date;
  /**
   * Step size in milliseconds applied per step-forward / step-back click.
   * Also the tick size used during auto-play (multiplied by speed).
   * Default: 300 000 ms (5 minutes).
   */
  stepMs?: number;
  /**
   * Called whenever the replay position changes.
   * Pass null to return to live mode (no time filter applied).
   */
  onAtChange: (date: Date | null) => void;
  /** Optional CSS class added to the root element for layout overrides. */
  className?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default step size: 5 minutes. */
const DEFAULT_STEP_MS = 5 * 60 * 1000;

/** Auto-play tick interval in ms (1 second wall-clock). */
const TICK_INTERVAL_MS = 1000;

/** Default fallback start time offset when at=null and play is pressed (1 hour). */
const DEFAULT_START_OFFSET_MS = 60 * 60 * 1000;

/** All available speed options, in ascending order. */
const SPEED_OPTIONS: PlaybackSpeed[] = [0.5, 1, 2, 4];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a Date as a short human-readable string for UI display.
 * Uses locale-aware date + time (no seconds) suitable for the status output.
 */
function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format a Date as an ISO 8601 datetime string for aria-valuetext.
 */
function isoDatetime(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Clamp a numeric timestamp to [min, max].
 */
function clampTime(ts: number, min?: number, max?: number): number {
  if (min !== undefined && ts < min) return min;
  if (max !== undefined && ts > max) return max;
  return ts;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Replay scrubber control bar.
 *
 * Renders play/pause, step-back, step-forward, speed selector, and range slider
 * controls for navigating a time-bounded replay window.
 *
 * @example
 * ```tsx
 * <ReplayScrubber
 *   at={at}
 *   minAt={new Date("2024-01-01")}
 *   maxAt={new Date()}
 *   onAtChange={setAt}
 * />
 * ```
 */
export function ReplayScrubber({
  at,
  minAt,
  maxAt,
  stepMs = DEFAULT_STEP_MS,
  onAtChange,
  className,
}: ReplayScrubberProps) {
  // ── Internal state ──────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  // Ref to always-current `at` value inside the interval closure.
  // Using a ref avoids stale closure issues — the interval callback reads
  // the ref value rather than the captured `at` from the last render.
  const atRef = useRef<Date | null>(at);
  atRef.current = at;

  const onAtChangeRef = useRef(onAtChange);
  onAtChangeRef.current = onAtChange;

  // IDs for accessible label associations
  const rangeId         = useId();
  const speedSelectId   = useId();
  const statusOutputId  = useId();

  // ── Derived values ──────────────────────────────────────────────────────────
  const effectiveMax = maxAt ?? new Date();
  const rangeMin   = minAt  ? minAt.getTime()         : 0;
  const rangeMax   = effectiveMax.getTime();
  const rangeValue = at ? at.getTime() : rangeMin;

  const rangeEnabled = at !== null && minAt !== undefined;

  // ── Auto-play interval ──────────────────────────────────────────────────────
  //
  // The interval advances `at` by stepMs * speed every TICK_INTERVAL_MS ms.
  // When `at` reaches effectiveMax, the interval stops automatically.
  //
  // The interval is created / destroyed by the effect each time `isPlaying`
  // or `speed` changes.  The ref pattern keeps the closure fresh without
  // causing the effect to re-run on every `at` change.
  useEffect(() => {
    if (!isPlaying) return;

    const intervalId = setInterval(() => {
      const current = atRef.current;
      const max = effectiveMax.getTime();

      // Compute start position if at was null when play was pressed
      const currentTs = current ? current.getTime() : Date.now() - DEFAULT_START_OFFSET_MS;
      const nextTs = clampTime(currentTs + stepMs * speed, rangeMin || undefined, max);

      onAtChangeRef.current(new Date(nextTs));

      // Stop at end of range
      if (nextTs >= max) {
        setIsPlaying(false);
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(intervalId);
    // effectiveMax changes every render (new Date()), so we exclude it.
    // We only want the interval to restart when isPlaying or speed changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, speed, stepMs, rangeMin]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handlePlay = useCallback(() => {
    // If at is null (live mode), initialise to start of range before playing
    if (atRef.current === null) {
      const startTs = minAt
        ? minAt.getTime()
        : Date.now() - DEFAULT_START_OFFSET_MS;
      onAtChangeRef.current(new Date(startTs));
    }
    setIsPlaying(true);
  }, [minAt]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleStepBack = useCallback(() => {
    // Pause if playing
    setIsPlaying(false);
    const current = atRef.current;
    if (current === null) return;
    const nextTs = clampTime(
      current.getTime() - stepMs,
      minAt ? minAt.getTime() : undefined,
      undefined
    );
    onAtChangeRef.current(new Date(nextTs));
  }, [stepMs, minAt]);

  const handleStepForward = useCallback(() => {
    // Pause if playing
    setIsPlaying(false);
    const current = atRef.current;
    const maxTs = effectiveMax.getTime();
    if (current === null) {
      // Initialise to minAt or 1hr ago
      const startTs = minAt ? minAt.getTime() : Date.now() - DEFAULT_START_OFFSET_MS;
      onAtChangeRef.current(new Date(Math.min(startTs + stepMs, maxTs)));
      return;
    }
    const nextTs = clampTime(current.getTime() + stepMs, undefined, maxTs);
    onAtChangeRef.current(new Date(nextTs));
  }, [stepMs, minAt, effectiveMax]);

  const handleRangeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const ts = Number(e.target.value);
      onAtChangeRef.current(new Date(ts));
    },
    []
  );

  const handleSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = parseFloat(e.target.value) as PlaybackSpeed;
      setSpeed(val);
    },
    []
  );

  const handleReturnToLive = useCallback(() => {
    setIsPlaying(false);
    onAtChangeRef.current(null);
  }, []);

  // ── Accessible status text ──────────────────────────────────────────────────
  const statusText = at
    ? `Replay at ${formatTimestamp(at)}${isPlaying ? ` — playing at ${speed}×` : " — paused"}`
    : "Live mode — no replay active";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-playing={isPlaying ? "true" : undefined}
      data-replaying={at !== null ? "true" : undefined}
      role="group"
      aria-label="Replay scrubber controls"
    >
      {/* ── Transport buttons ── */}
      <div className={styles.transport} aria-label="Transport controls">
        {/* Step back */}
        <button
          type="button"
          className={styles.transportBtn}
          onClick={handleStepBack}
          disabled={at === null}
          aria-label="Step back one step"
          aria-disabled={at === null}
          data-testid="scrubber-step-back"
        >
          {/* Step-back icon: |◀ */}
          <svg
            className={styles.transportIcon}
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
            fill="currentColor"
          >
            <path d="M4 4h2v12H4V4zm10 10.76L8.72 10 14 5.24V4l-7 6 7 6v-1.24z" />
          </svg>
        </button>

        {/* Play / Pause */}
        {isPlaying ? (
          <button
            type="button"
            className={[styles.transportBtn, styles.playPauseBtn].join(" ")}
            onClick={handlePause}
            aria-label="Pause replay"
            data-testid="scrubber-pause"
          >
            {/* Pause icon: ‖ */}
            <svg
              className={styles.transportIcon}
              viewBox="0 0 20 20"
              aria-hidden="true"
              focusable="false"
              fill="currentColor"
            >
              <path d="M5 4h3v12H5V4zm7 0h3v12h-3V4z" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className={[styles.transportBtn, styles.playPauseBtn].join(" ")}
            onClick={handlePlay}
            aria-label={at !== null ? "Play replay" : "Start replay from beginning"}
            data-testid="scrubber-play"
          >
            {/* Play icon: ▶ */}
            <svg
              className={styles.transportIcon}
              viewBox="0 0 20 20"
              aria-hidden="true"
              focusable="false"
              fill="currentColor"
            >
              <path d="M6 4l12 6-12 6V4z" />
            </svg>
          </button>
        )}

        {/* Step forward */}
        <button
          type="button"
          className={styles.transportBtn}
          onClick={handleStepForward}
          aria-label="Step forward one step"
          data-testid="scrubber-step-forward"
        >
          {/* Step-forward icon: ▶| */}
          <svg
            className={styles.transportIcon}
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
            fill="currentColor"
          >
            <path d="M14 4h2v12h-2V4zM6 5.24v9.52L11.28 10 6 5.24zM6 4v1.24l.01.01L13 10l-7 6v-1.24L5.99 14.5 6 4z" />
          </svg>
        </button>
      </div>

      {/* ── Range slider ── */}
      <div className={styles.sliderGroup}>
        <label htmlFor={rangeId} className={styles.sliderLabel}>
          Timeline
        </label>
        <input
          id={rangeId}
          type="range"
          className={styles.slider}
          min={rangeMin}
          max={rangeMax}
          value={rangeValue}
          step={stepMs}
          disabled={!rangeEnabled}
          onChange={handleRangeChange}
          aria-label="Replay timeline position"
          aria-valuemin={rangeMin}
          aria-valuemax={rangeMax}
          aria-valuenow={rangeValue}
          aria-valuetext={at ? isoDatetime(at) : "Live"}
          data-testid="scrubber-range"
        />
        {/* Current timestamp label */}
        <span className={styles.sliderTimestamp} aria-hidden="true">
          {at ? (
            <time dateTime={at.toISOString()} className={styles.sliderTime}>
              {formatTimestamp(at)}
            </time>
          ) : (
            <span className={styles.sliderLive}>LIVE</span>
          )}
        </span>
      </div>

      {/* ── Speed selector ── */}
      <div className={styles.speedGroup}>
        <label htmlFor={speedSelectId} className={styles.speedLabel}>
          Speed
        </label>
        <select
          id={speedSelectId}
          className={styles.speedSelect}
          value={speed}
          onChange={handleSpeedChange}
          aria-label="Playback speed"
          data-testid="scrubber-speed"
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>

      {/* ── Return to live button (shown when in replay mode) ── */}
      {at !== null && (
        <button
          type="button"
          className={styles.liveButton}
          onClick={handleReturnToLive}
          aria-label="Return to live view — exit replay mode"
          data-testid="scrubber-live"
        >
          <span className={styles.liveDot} aria-hidden="true" />
          Live
        </button>
      )}

      {/* ── Screen-reader status output ── */}
      <output
        id={statusOutputId}
        className={styles.srOnly}
        aria-live="polite"
        aria-atomic="true"
        data-testid="scrubber-status"
      >
        {statusText}
      </output>
    </div>
  );
}

export default ReplayScrubber;
