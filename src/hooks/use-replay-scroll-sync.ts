/**
 * src/hooks/use-replay-scroll-sync.ts
 *
 * useReplayScrollSync — scroll the active stop card into view when the
 * replay cursor advances or is manually scrubbed.
 *
 * Overview
 * ────────
 * Watches `activeIndex` (the 1-based stopIndex of the currently active stop
 * card) and calls `scrollIntoView` on the matching `[data-stop-index="N"]`
 * element inside the provided scroll container whenever `activeIndex` changes.
 *
 * This provides continuous visual feedback as the ReplayScrubber's `at`
 * timestamp progresses through the journey timeline — keeping the active stop
 * card always visible in the M2StopSidebar without any user gesture.
 *
 * Targeting strategy
 * ──────────────────
 * The hook queries the container for `[data-stop-index="${activeIndex}"]`.
 * In M2StopSidebar each `<li>` has `data-stop-index={stop.stopIndex}` set,
 * so this selector correctly targets the active row regardless of DOM nesting.
 *
 * Reduced-motion
 * ──────────────
 * The `scrollBehavior` parameter defaults to "smooth" for visual continuity
 * during replay playback.  Callers that detect `prefers-reduced-motion: reduce`
 * should pass `scrollBehavior="instant"` to honour the user's motion preference.
 *
 * Guard conditions
 * ────────────────
 * The hook is a no-op when:
 *   • `activeIndex` is null   — no active stop (empty journey or before first stop)
 *   • `listRef.current` is null — container not yet mounted
 *   • The element is not found — activeIndex references a stop not in the DOM
 *
 * Usage
 * ─────
 * ```tsx
 * const listRef = useRef<HTMLOListElement>(null);
 *
 * useReplayScrollSync({ listRef, activeIndex: replayActiveIndex });
 *
 * return (
 *   <ol ref={listRef}>
 *     {stops.map((stop) => (
 *       <li key={stop.eventId} data-stop-index={stop.stopIndex}>
 *         <StopCard ... />
 *       </li>
 *     ))}
 *   </ol>
 * );
 * ```
 */

import { useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseReplayScrollSyncOptions {
  /**
   * Ref to the scrollable container element (e.g. `<ol>` or `<ul>`).
   * The hook queries this element for `[data-stop-index="${activeIndex}"]`
   * to locate the active stop card.
   *
   * Accepts any readonly ref whose `.current` can be an `HTMLElement` or null.
   * Compatible with `useRef<HTMLOListElement>(null)`, `useRef<HTMLUListElement>(null)`,
   * and any other HTMLElement ref.
   */
  listRef: { readonly current: HTMLElement | null };

  /**
   * 1-based stop index of the currently active stop.
   *
   * Matches `JourneyStop.stopIndex` (which is 1-based, not 0-based).
   * null = no active stop → hook is a no-op for that render cycle.
   */
  activeIndex: number | null;

  /**
   * Scroll behavior forwarded to `scrollIntoView`.
   *
   * "smooth" (default) — animated scroll, good for replay playback.
   * "instant"          — immediate scroll, recommended when the user has
   *                      `prefers-reduced-motion: reduce` set.
   * "auto"             — browser default (usually smooth where supported).
   *
   * @default "smooth"
   */
  scrollBehavior?: ScrollBehavior;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useReplayScrollSync
 *
 * Scrolls the active stop card into view inside a scrollable list container
 * whenever `activeIndex` changes.
 *
 * The hook fires a DOM `scrollIntoView` call after each render where
 * `activeIndex` changes value (React's `useEffect` equality check).  This
 * means the scroll fires once per active-stop transition, not on every render.
 *
 * @param options  { listRef, activeIndex, scrollBehavior? }
 */
export function useReplayScrollSync({
  listRef,
  activeIndex,
  scrollBehavior = "smooth",
}: UseReplayScrollSyncOptions): void {
  useEffect(() => {
    // Guard: nothing to scroll to
    if (activeIndex === null || !listRef.current) return;

    // Locate the active stop card by its data attribute
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-stop-index="${activeIndex}"]`
    );

    // Guard: element not in the DOM (e.g. activeIndex references a stop
    // that hasn't been rendered yet, or the list is empty)
    if (!activeEl || typeof activeEl.scrollIntoView !== "function") return;

    // Scroll the active card into the visible area of the sidebar
    activeEl.scrollIntoView({ behavior: scrollBehavior, block: "nearest" });
  }, [activeIndex, listRef, scrollBehavior]);
}

export default useReplayScrollSync;
