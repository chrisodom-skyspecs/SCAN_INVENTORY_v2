/**
 * SignatureCapture — canvas-based handwritten signature component
 *
 * Features
 * ─────────
 * • Canvas-based freehand drawing via Pointer Events API (handles mouse,
 *   touch, and stylus input uniformly — no separate touch handlers needed).
 * • Per-stroke undo — removes the most recently drawn stroke while keeping
 *   all prior strokes intact.
 * • Clear — resets the canvas to blank state.
 * • Export — `onChange` is called with a PNG base64 data URL on every stroke
 *   commit.  It receives `null` when the canvas is cleared.
 *
 * Drawing approach
 * ────────────────
 * • Incremental draw during pointer-move: line segments are drawn in real
 *   time for immediate tactile feedback.
 * • Full redraw on commit: when the pointer lifts, the entire stroke history
 *   is redrawn using quadratic Bézier curves through midpoints, producing a
 *   smoother final result than raw line segments.
 * • Device pixel ratio: the canvas physical size is set to `offsetSize × dpr`
 *   so strokes are crisp on high-DPI displays.  All point coordinates are
 *   stored in CSS pixels and the context is pre-scaled by `dpr`.
 *
 * Color strategy
 * ──────────────
 * The canvas 2D context requires concrete color values — it cannot resolve
 * CSS custom properties directly.  We bridge this gap by reading the canvas
 * element's `--sig-stroke-color` custom property via `getComputedStyle()` at
 * draw time, then passing the resolved concrete value to the context.
 *
 * The canvas background is intentionally held at white (--_n-0) in both light
 * and dark themes because a signature pad should always read like pen on paper.
 * Explicit dark-theme overrides in the module CSS preserve this contract.
 *
 * Accessibility
 * ─────────────
 * • canvas: `role="img"` with dynamic `aria-label` ("empty" / "contains signature").
 * • Keyboard: focus → Delete clears, Ctrl+Z / Cmd+Z undoes.
 * • Control buttons: descriptive `aria-label`, disabled when irrelevant.
 * • Touch targets: ≥ 44 × 44 px on all interactive controls (WCAG 2.5.5).
 * • WCAG AA contrast: dark ink on white canvas in both themes.
 * • prefers-reduced-motion: no animations used in canvas drawing.
 *
 * Design system compliance
 * ─────────────────────────
 * • All colors via CSS custom properties — no hex literals.
 * • Inter Tight for control labels and placeholder text.
 * • IBM Plex Mono for the stroke-count indicator.
 *
 * Usage
 * ─────
 * ```tsx
 * const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
 *
 * <SignatureCapture
 *   onChange={setSigDataUrl}
 *   disabled={isSubmitting}
 * />
 * ```
 *
 * The parent stores the base64 data URL and includes it in the mutation
 * payload.  `null` means the canvas is empty (no signature captured).
 */

"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import styles from "./SignatureCapture.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single (x, y) coordinate in CSS pixel space. */
interface Point {
  x: number;
  y: number;
}

/** An ordered array of points forming one continuous pen-down → pen-up path. */
type Stroke = Point[];

// ─── Public API ────────────────────────────────────────────────────────────────

export interface SignatureCaptureProps {
  /**
   * Called with the PNG base64 data URL (e.g. `data:image/png;base64,...`)
   * after each stroke is committed.  Called with `null` when the canvas is
   * cleared or after an undo that empties the stroke history.
   */
  onChange?: (dataUrl: string | null) => void;

  /** Disables pointer input and control buttons when `true`. */
  disabled?: boolean;

  /**
   * Canvas drawing area height in CSS pixels.
   * @default 200
   */
  height?: number;

  /**
   * Pen stroke width in CSS pixels.
   * @default 2.5
   */
  strokeWidth?: number;

  /**
   * Placeholder text shown inside the canvas area when no strokes exist.
   * @default "Sign here"
   */
  placeholder?: string;

  /**
   * Additional CSS class applied to the root wrapper element.
   * Use sparingly — prefer the `height` prop for layout adjustments.
   */
  className?: string;

  /**
   * Base aria-label for the canvas element.  The component appends either
   * "(empty)" or "(contains signature)" to describe the current state.
   * @default "Signature drawing area"
   */
  ariaLabel?: string;

  /**
   * `data-testid` value on the root element.  Child elements append a
   * suffix: `-canvas`, `-undo`, `-clear`, `-stroke-count`, `-placeholder`.
   * @default "signature-capture"
   */
  testId?: string;
}

// ─── Internal draw helpers ────────────────────────────────────────────────────

/**
 * Resolve the stroke color from the `--sig-stroke-color` CSS custom property
 * set on the canvas element.  Falls back to the element's computed `color`
 * value, which is defined in the module CSS.
 *
 * This is the canonical pattern for bridging CSS custom properties into
 * canvas 2D context draw calls — no hex literals in component code.
 */
function resolveStrokeColor(canvas: HTMLCanvasElement): string {
  const style = getComputedStyle(canvas);
  const custom = style.getPropertyValue("--sig-stroke-color").trim();
  return custom || style.color || "hsl(210, 18%, 9%)";
}

/**
 * Convert a pointer event's client coordinates to CSS-pixel canvas coordinates
 * by subtracting the canvas element's bounding rect origin.
 */
function pointFromEvent(
  e: PointerEvent | ReactPointerEvent<HTMLCanvasElement>,
  rect: DOMRect
): Point {
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

/**
 * Size the canvas physical pixel buffer to `offsetWidth × dpr` and
 * `offsetHeight × dpr`.  Resets the context state (setting canvas.width/height
 * clears the context including transforms).
 * Returns the device pixel ratio used so callers can re-apply `ctx.scale(dpr, dpr)`.
 */
function sizeCanvas(canvas: HTMLCanvasElement): number {
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  return dpr;
}

/**
 * Draw all strokes onto the canvas context using quadratic Bézier curves
 * through midpoints for smooth, natural-looking lines.
 *
 * Assumes the context transform is `scale(dpr, dpr)` so draw calls use CSS
 * pixel coordinates.
 */
function drawStrokes(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  strokeColor: string,
  strokeWidth: number
): void {
  // Clear the full visible area in CSS pixel space (transform already applied).
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (strokes.length === 0) return;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle   = strokeColor;
  ctx.lineWidth   = strokeWidth;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;

    if (stroke.length === 1) {
      // Single tap — render as a filled circle dot.
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, strokeWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);

    // Quadratic Bézier through midpoints — control point = current point,
    // end point = midpoint between current and next.  This produces smooth
    // curves without sharp angle artifacts at high-speed strokes.
    for (let i = 1; i < stroke.length - 1; i++) {
      const midX = (stroke[i].x + stroke[i + 1].x) / 2;
      const midY = (stroke[i].y + stroke[i + 1].y) / 2;
      ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, midX, midY);
    }

    // Final segment: straight line to the last captured point.
    const last = stroke[stroke.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SignatureCapture
 *
 * Renders a touch-optimized canvas area for capturing handwritten signatures
 * with undo, clear, and base64 export functionality.
 */
export function SignatureCapture({
  onChange,
  disabled = false,
  height = 200,
  strokeWidth = 2.5,
  placeholder = "Sign here",
  className,
  ariaLabel = "Signature drawing area",
  testId = "signature-capture",
}: SignatureCaptureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Store onChange in a ref so drawing callbacks never capture a stale closure.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // ── Stroke history ────────────────────────────────────────────────────────
  // Both React state (for re-renders that update button disabled/aria states)
  // and a ref (for synchronous access in event handlers without stale closures).

  const [strokes, setStrokes]   = useState<Stroke[]>([]);
  const strokesRef              = useRef<Stroke[]>([]);

  // ── Active stroke (pointer-down → pointer-up, not yet committed) ──────────
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef     = useRef(false);

  // ── DPR ref ───────────────────────────────────────────────────────────────
  // Persisted so the context scale is not re-applied unnecessarily.
  const dprRef = useRef(1);

  // ── Derived state ─────────────────────────────────────────────────────────
  const isEmpty = strokes.length === 0;

  // ── Canvas init + resize observer ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const initialize = () => {
      // sizeCanvas resets the context (canvas.width assignment clears state).
      const dpr = sizeCanvas(canvas);
      dprRef.current = dpr;
      // Re-apply the DPR scale so all draw calls use CSS pixel coordinates.
      ctx.scale(dpr, dpr);
      // Redraw persisted strokes into the freshly sized buffer.
      const color = resolveStrokeColor(canvas);
      drawStrokes(canvas, ctx, strokesRef.current, color, strokeWidth);
    };

    initialize();

    const observer = new ResizeObserver(initialize);
    observer.observe(canvas);

    return () => observer.disconnect();
  }, [strokeWidth]); // re-run when strokeWidth changes (affects redraw)

  // ── Internal redraw (after commit / undo / clear) ─────────────────────────
  const redraw = useCallback(
    (nextStrokes: Stroke[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const color = resolveStrokeColor(canvas);
      drawStrokes(canvas, ctx, nextStrokes, color, strokeWidth);
    },
    [strokeWidth]
  );

  // ── Export ────────────────────────────────────────────────────────────────
  const exportDataUrl = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || strokesRef.current.length === 0) return null;
    return canvas.toDataURL("image/png");
  }, []);

  // ── Commit current stroke to history ─────────────────────────────────────
  const commitStroke = useCallback(() => {
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    isDrawingRef.current = false;

    const finishedStroke = currentStrokeRef.current;
    currentStrokeRef.current = null;

    if (finishedStroke.length === 0) return;

    const nextStrokes = [...strokesRef.current, finishedStroke];
    strokesRef.current = nextStrokes;
    setStrokes(nextStrokes);

    // Full redraw with smooth Bézier curves now that we have the complete stroke.
    redraw(nextStrokes);

    // Export and notify parent after the redraw has settled on the canvas.
    const dataUrl = exportDataUrl();
    onChangeRef.current?.(dataUrl);
  }, [redraw, exportDataUrl]);

  // ── Pointer event handlers ────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      // Prevent default so the browser does not scroll / select text on mobile.
      e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;

      // Capture the pointer: we keep receiving events even if the user drifts
      // outside the canvas bounds (important for mobile drag-out behavior).
      canvas.setPointerCapture(e.pointerId);

      const rect = canvas.getBoundingClientRect();
      const point = pointFromEvent(e, rect);

      isDrawingRef.current      = true;
      currentStrokeRef.current  = [point];

      // Draw a dot immediately for zero-latency visual feedback.
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const color = resolveStrokeColor(canvas);
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, strokeWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    },
    [disabled, strokeWidth]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return;
      e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect  = canvas.getBoundingClientRect();
      const point = pointFromEvent(e, rect);
      const stroke = currentStrokeRef.current;
      const prev   = stroke[stroke.length - 1];
      stroke.push(point);

      // Incremental line segment for real-time visual feedback.
      const color = resolveStrokeColor(canvas);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = strokeWidth;
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.restore();
    },
    [strokeWidth]
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      commitStroke();
    },
    [commitStroke]
  );

  const handlePointerCancel = useCallback(() => {
    // Pointer was interrupted (e.g. incoming call on mobile).
    // Discard the in-progress stroke and redraw cleanly.
    isDrawingRef.current       = false;
    currentStrokeRef.current   = null;
    redraw(strokesRef.current);
  }, [redraw]);

  // ── Clear ─────────────────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    if (disabled) return;
    strokesRef.current = [];
    setStrokes([]);
    redraw([]);
    onChangeRef.current?.(null);
  }, [disabled, redraw]);

  // ── Undo ──────────────────────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    if (disabled || strokesRef.current.length === 0) return;

    const nextStrokes = strokesRef.current.slice(0, -1);
    strokesRef.current = nextStrokes;
    setStrokes(nextStrokes);
    redraw(nextStrokes);

    // Export after redraw so the data URL reflects the updated canvas state.
    const canvas = canvasRef.current;
    const dataUrl = (canvas && nextStrokes.length > 0)
      ? canvas.toDataURL("image/png")
      : null;
    onChangeRef.current?.(dataUrl);
  }, [disabled, redraw]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Delete / Backspace — clear all.  Ctrl+Z / Cmd+Z — undo one stroke.

  const handleCanvasKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        handleClear();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
    },
    [disabled, handleClear, handleUndo]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const canvasAriaLabel = `${ariaLabel} (${isEmpty ? "empty" : "contains signature"})`;
  const strokeLabel = `${strokes.length} stroke${strokes.length !== 1 ? "s" : ""}`;

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-disabled={disabled ? "true" : undefined}
      data-empty={isEmpty ? "true" : undefined}
    >
      {/* ── Canvas area ─────────────────────────────────────────────────── */}
      <div
        className={[
          styles.canvasWrap,
          disabled ? styles.canvasWrapDisabled : "",
        ].filter(Boolean).join(" ")}
        style={{ height: `${height}px` }}
      >
        <canvas
          ref={canvasRef}
          className={[
            styles.canvas,
            disabled ? styles.canvasDisabled : "",
          ].filter(Boolean).join(" ")}
          role="img"
          aria-label={canvasAriaLabel}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={handleCanvasKeyDown}
          data-testid={`${testId}-canvas`}
          style={{ touchAction: "none" }}
        />

        {/*
         * Placeholder — shown when the canvas is empty.
         * aria-hidden: the canvas aria-label already conveys "empty" state.
         */}
        {isEmpty && (
          <div
            className={styles.placeholder}
            aria-hidden="true"
            data-testid={`${testId}-placeholder`}
          >
            {placeholder}
          </div>
        )}

        {/* Baseline guide — visual signature guideline */}
        <div className={styles.baseline} aria-hidden="true" />
      </div>

      {/* ── Controls row ────────────────────────────────────────────────── */}
      <div
        className={styles.controls}
        role="group"
        aria-label="Signature controls"
      >
        {/* Undo */}
        <button
          type="button"
          className={[styles.controlBtn, styles.undoBtn].join(" ")}
          onClick={handleUndo}
          disabled={disabled || isEmpty}
          aria-label="Undo last stroke"
          data-testid={`${testId}-undo`}
        >
          {/* Counter-clockwise undo arrow */}
          <svg
            className={styles.controlIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7v6h6" />
            <path d="M3 13a9 9 0 1 0 2.68-6.36L3 7" />
          </svg>
          Undo
        </button>

        {/* Stroke count — live region so assistive tech hears changes */}
        <span
          className={styles.strokeCount}
          aria-live="polite"
          aria-atomic="true"
          aria-label={isEmpty ? "No signature" : strokeLabel}
          data-testid={`${testId}-stroke-count`}
        >
          {isEmpty ? "No signature" : strokeLabel}
        </span>

        {/* Clear */}
        <button
          type="button"
          className={[styles.controlBtn, styles.clearBtn].join(" ")}
          onClick={handleClear}
          disabled={disabled || isEmpty}
          aria-label="Clear signature"
          data-testid={`${testId}-clear`}
        >
          {/* Trash icon */}
          <svg
            className={styles.controlIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
          Clear
        </button>
      </div>
    </div>
  );
}

export default SignatureCapture;
