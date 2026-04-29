/**
 * src/hooks/use-scroll-position-indicator.ts
 *
 * useScrollPositionIndicator — computes scroll position indicator geometry
 * from a scrollable element's scroll metrics and keeps it in sync via scroll
 * and resize events.
 *
 * Overview
 * ────────
 * Returns a `listRef` to attach to any scrollable container, and a `state`
 * object describing the current indicator thumb position and visibility.
 * The indicator geometry is recomputed whenever the container scrolls or
 * resizes.
 *
 * Architecture
 * ────────────
 * The hook creates a shared ref (`listRef`) that serves as the coordination
 * point between the scroll container and the position indicator:
 *
 *   1. The caller attaches `listRef` to the scrollable element via `ref={listRef}`.
 *   2. The hook attaches a passive `scroll` event listener to `listRef.current`.
 *   3. A `ResizeObserver` on `listRef.current` catches size/content changes.
 *   4. Each event fires `compute()` which reads `scrollTop`, `scrollHeight`,
 *      and `clientHeight` from `listRef.current` and updates `state`.
 *   5. The caller renders the position indicator thumb using `state.thumbTop`
 *      and `state.thumbHeight` as inline styles, and `state.visible` to
 *      conditionally mount the track element.
 *
 * This shared-ref pattern ensures the indicator always reflects the current
 * scroll position of the main timeline element — there is no polling, no
 * external state synchronisation, and no redundant renders between the
 * scroll container and the indicator.
 *
 * Geometry
 * ────────
 * thumb height: (clientHeight / scrollHeight) × clientHeight, clamped to ≥ MIN_THUMB_PX.
 * thumb top:    (scrollTop / scrollRange) × maxThumbTop
 *               where scrollRange = scrollHeight - clientHeight
 *                     maxThumbTop = clientHeight - thumbHeight
 *
 * Both values are expressed in pixels (inline style) so the indicator
 * accurately reflects any scroll offset within a continuously varying
 * content height.
 *
 * Guard conditions
 * ────────────────
 * The hook is a no-op (state.visible = false) when:
 *   • `listRef.current` is null (element not yet mounted or unmounted).
 *   • `scrollHeight ≤ clientHeight` (no overflow — nothing to indicate).
 *
 * Re-attachment
 * ─────────────
 * The `useEffect` depends on `contentKey`.  Callers should pass a value that
 * changes whenever the scrollable element is conditionally remounted (e.g.,
 * switching from a loading skeleton to real content).  This causes the effect
 * to re-run, reattach listeners to the new element, and recompute geometry.
 *
 * Usage
 * ─────
 * ```tsx
 * const contentKey = `${isLoading ? "loading" : "loaded"}:${items.length}`;
 * const { state, listRef } = useScrollPositionIndicator(contentKey);
 *
 * return (
 *   <div style={{ position: "relative" }}>
 *     {state.visible && (
 *       <div
 *         aria-hidden="true"
 *         style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3 }}
 *       >
 *         <div
 *           style={{
 *             position: "absolute",
 *             top:    `${state.thumbTop}px`,
 *             height: `${state.thumbHeight}px`,
 *           }}
 *         />
 *       </div>
 *     )}
 *     <ol ref={listRef} style={{ overflowY: "auto" }}>
 *       {items.map(item => <li key={item.id}>{item.name}</li>)}
 *     </ol>
 *   </div>
 * );
 * ```
 *
 * @see MiniMapSidebar — primary consumer (`.positionTrack` + `.positionThumb`)
 */

import { useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Geometry state for the scroll position indicator thumb.
 *
 * `visible`     — whether the indicator should be rendered.  False when there
 *                 is no scroll overflow (scrollHeight ≤ clientHeight) or when
 *                 the scroll container is not yet mounted.
 * `thumbTop`    — distance from the top of the track to the thumb's top edge,
 *                 in pixels.  Derived from scrollTop / scrollRange.
 * `thumbHeight` — height of the thumb in pixels.  Derived from
 *                 (clientHeight / scrollHeight) × clientHeight, clamped to
 *                 at least MIN_THUMB_PX.
 */
export interface ScrollPositionIndicatorState {
  visible: boolean;
  thumbTop: number;
  thumbHeight: number;
}

export interface UseScrollPositionIndicatorOptions {
  /**
   * A value that changes whenever the scrollable element is conditionally
   * remounted (e.g., switching from a loading skeleton to real list content).
   *
   * When `contentKey` changes, the hook re-runs its effect to reattach scroll
   * and resize listeners to the new element and recompute indicator geometry.
   *
   * Accepts any value — only reference equality matters for effect re-runs.
   * Common patterns:
   *   • `\`${isLoading ? "loading" : "loaded"}:${items.length}\``
   *   • `items.length` (if loading state does not affect mount/unmount)
   *   • `undefined` if the scrollable element never remounts
   */
  contentKey?: unknown;

  /**
   * Minimum thumb height in pixels.
   * Ensures the indicator thumb is always perceivable, even for very long lists.
   *
   * @default 16
   */
  minThumbPx?: number;
}

export interface UseScrollPositionIndicatorResult {
  /**
   * Current indicator geometry state.
   *
   * `visible`     — mount the track element only when true.
   * `thumbTop`    — apply as `top: \`${thumbTop}px\`` inline style on the thumb.
   * `thumbHeight` — apply as `height: \`${thumbHeight}px\`` inline style on the thumb.
   */
  state: ScrollPositionIndicatorState;

  /**
   * Ref to attach to the scrollable container element.
   *
   * The hook reads `scrollTop`, `scrollHeight`, and `clientHeight` from
   * `listRef.current` whenever a scroll or resize event fires.
   *
   * Attach via: `<ol ref={listRef}>` or `<div ref={listRef}>`.
   *
   * The ref is typed as `HTMLElement | null` to work with any scrollable
   * HTML element (ol, ul, div, etc.).
   */
  listRef: React.RefObject<HTMLElement | null>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default minimum thumb height in pixels. */
const DEFAULT_MIN_THUMB_PX = 16;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useScrollPositionIndicator
 *
 * Returns `{ state, listRef }` for rendering a scroll position indicator
 * (a custom scrollbar thumb) that stays in sync with a scrollable element's
 * current scroll position.
 *
 * The shared-ref approach ensures the indicator and the main timeline scroll
 * container are connected through a single DOM ref:
 *   • Caller attaches `listRef` to the scrollable element.
 *   • Hook attaches scroll + resize listeners to `listRef.current`.
 *   • Hook updates `state` on every scroll/resize event.
 *   • Caller renders the indicator thumb using `state.thumbTop` / `state.thumbHeight`.
 *
 * @example
 * ```tsx
 * const { state, listRef } = useScrollPositionIndicator({
 *   contentKey: `${isLoading}:${items.length}`,
 * });
 *
 * return (
 *   <div style={{ position: "relative" }}>
 *     {state.visible && (
 *       <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3 }}>
 *         <div style={{ position: "absolute", top: `${state.thumbTop}px`, height: `${state.thumbHeight}px` }} />
 *       </div>
 *     )}
 *     <ol ref={listRef} style={{ overflowY: "auto" }}>
 *       {items.map(item => <li key={item.id}>{item.text}</li>)}
 *     </ol>
 *   </div>
 * );
 * ```
 */
export function useScrollPositionIndicator({
  contentKey,
  minThumbPx = DEFAULT_MIN_THUMB_PX,
}: UseScrollPositionIndicatorOptions = {}): UseScrollPositionIndicatorResult {
  /**
   * Shared ref — attached to the scrollable container element by the caller.
   * The hook reads scroll metrics from this ref on every scroll and resize event.
   * Using HTMLElement (not HTMLOListElement) makes the hook work with any
   * scrollable element type (ol, ul, div, etc.).
   */
  const listRef = useRef<HTMLElement | null>(null);

  const [state, setState] = useState<ScrollPositionIndicatorState>({
    visible: false,
    thumbTop: 0,
    thumbHeight: 0,
  });

  useEffect(() => {
    const list = listRef.current;

    // Guard: container not yet mounted (ref not yet populated by React commit)
    if (!list) return;

    /**
     * compute — reads the current scroll metrics from the container element
     * and updates the indicator geometry state.
     *
     * Called:
     *   • Once on effect mount (initial measurement after element renders).
     *   • On every "scroll" event (passive, no layout thrash).
     *   • On every ResizeObserver notification (container or content resize).
     */
    function compute() {
      const el = listRef.current;
      if (!el) return;

      const { scrollTop, scrollHeight, clientHeight } = el;

      // No overflow → hide the indicator
      if (scrollHeight <= clientHeight) {
        setState({ visible: false, thumbTop: 0, thumbHeight: 0 });
        return;
      }

      // Thumb height proportional to the fraction of content visible,
      // clamped to at least minThumbPx so the thumb is always legible.
      const rawThumbHeight = (clientHeight / scrollHeight) * clientHeight;
      const thumbHeight = Math.max(rawThumbHeight, minThumbPx);

      // Maximum thumb top offset — keeps the thumb from overflowing the track.
      const maxThumbTop = clientHeight - thumbHeight;

      // Thumb top proportional to the scroll position within the scrollable range.
      // scrollRange = total distance the list can be scrolled.
      const scrollRange = scrollHeight - clientHeight;
      const thumbTop =
        scrollRange > 0 ? (scrollTop / scrollRange) * maxThumbTop : 0;

      setState({ visible: true, thumbTop, thumbHeight });
    }

    // Initial measurement — runs synchronously after mount so the initial
    // indicator geometry is correct even before any scroll event fires.
    compute();

    // Attach a passive scroll listener so the indicator updates with every scroll
    // without blocking the main thread (passive: true).
    list.addEventListener("scroll", compute, { passive: true });

    // ResizeObserver — recomputes geometry when the container or its content
    // changes size (e.g., dynamic content loads, font scaling, viewport resize).
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(compute);
      ro.observe(list);
    }

    // Cleanup: remove listeners and observer when the effect re-runs or
    // the component unmounts.
    return () => {
      list.removeEventListener("scroll", compute);
      ro?.disconnect();
    };
    // contentKey drives re-attachment when the scrollable element is conditionally
    // remounted (e.g., loading skeleton → real list content transition).
    // minThumbPx is a primitive and unlikely to change, but including it ensures
    // the computation uses the latest value if the caller changes it between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, minThumbPx]);

  return { state, listRef };
}

export default useScrollPositionIndicator;
