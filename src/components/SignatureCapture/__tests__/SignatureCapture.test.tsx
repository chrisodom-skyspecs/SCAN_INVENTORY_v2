/**
 * @vitest-environment jsdom
 *
 * Unit tests for the SignatureCapture component.
 *
 * Tests cover:
 *   1.  Renders without error and shows expected structure.
 *   2.  Placeholder visible when empty, hidden after a stroke.
 *   3.  Undo button disabled when empty, enabled after a stroke.
 *   4.  Clear button disabled when empty, enabled after a stroke.
 *   5.  Stroke count indicator reflects the current number of strokes.
 *   6.  Canvas aria-label reflects empty vs. non-empty state.
 *   7.  onChange called with base64 data URL after a stroke is committed.
 *   8.  onChange called with null after clear.
 *   9.  onChange called with null after undo that empties stroke history.
 *   10. onChange called with base64 after undo that leaves strokes remaining.
 *   11. Undo removes exactly the last stroke (stroke count decrements by 1).
 *   12. Clear resets stroke count to 0.
 *   13. disabled prop: undo and clear buttons are disabled.
 *   14. disabled prop: pointer events do not trigger onChange.
 *   15. Keyboard Delete / Backspace clears the signature.
 *   16. Keyboard Ctrl+Z undoes the last stroke.
 *   17. Keyboard Cmd+Z (macOS) undoes the last stroke.
 *   18. Multiple strokes accumulate correctly.
 *   19. Custom placeholder text is rendered.
 *   20. Custom ariaLabel is reflected in the canvas aria-label.
 *   21. Custom height is applied to the canvas wrap element.
 *   22. Custom testId propagates to child elements.
 *   23. Pointer cancel clears the in-progress stroke without committing.
 *
 * Canvas API is mocked throughout because jsdom does not implement it.
 * ResizeObserver is also mocked (not available in jsdom).
 *
 * Run with:
 *   npx vitest run src/components/SignatureCapture/__tests__/SignatureCapture.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { SignatureCapture } from "../SignatureCapture";

// ─── Global mocks ─────────────────────────────────────────────────────────────

// Mock canvas context (jsdom does not implement Canvas API)
const mockCtx = {
  scale:              vi.fn(),
  clearRect:          vi.fn(),
  beginPath:          vi.fn(),
  moveTo:             vi.fn(),
  lineTo:             vi.fn(),
  stroke:             vi.fn(),
  fill:               vi.fn(),
  arc:                vi.fn(),
  quadraticCurveTo:   vi.fn(),
  setTransform:       vi.fn(),
  save:               vi.fn(),
  restore:            vi.fn(),
  strokeStyle:        "",
  fillStyle:          "",
  lineWidth:          0,
  lineCap:            "butt" as CanvasLineCap,
  lineJoin:           "miter" as CanvasLineJoin,
};

// Store the original implementations so we can restore them if needed
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToDataURL  = HTMLCanvasElement.prototype.toDataURL;

beforeEach(() => {
  // @ts-expect-error — mock returns simplified context object
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);
  HTMLCanvasElement.prototype.toDataURL  = vi.fn(() => "data:image/png;base64,MOCK_DATA");

  // getBoundingClientRect returns zero by default in jsdom — return sensible values
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0,
    width: 400, height: 200,
    top: 0, left: 0, right: 400, bottom: 200,
    toJSON: () => ({}),
  }));

  // setPointerCapture is not implemented in jsdom
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();

  // ResizeObserver is not available in jsdom.
  // Must use a regular function (not an arrow function) so `new` works correctly.
  global.ResizeObserver = vi.fn(function MockResizeObserver(
    this: ResizeObserver
  ) {
    (this as unknown as Record<string, unknown>).observe    = vi.fn();
    (this as unknown as Record<string, unknown>).unobserve  = vi.fn();
    (this as unknown as Record<string, unknown>).disconnect = vi.fn();
  }) as unknown as typeof ResizeObserver;

  // devicePixelRatio
  Object.defineProperty(window, "devicePixelRatio", {
    value:      1,
    writable:   true,
    configurable: true,
  });

  // Reset mock call counts between tests
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext   = originalGetContext;
  HTMLCanvasElement.prototype.toDataURL    = originalToDataURL;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fire a full pointer-down → pointer-move → pointer-up sequence on the canvas
 * to simulate drawing a single stroke.
 */
function drawStroke(
  canvas: HTMLElement,
  points: Array<{ x: number; y: number }> = [
    { x: 10, y: 10 },
    { x: 50, y: 30 },
    { x: 90, y: 10 },
  ]
): void {
  const [first, ...rest] = points;

  fireEvent.pointerDown(canvas, {
    pointerId: 1,
    clientX: first.x,
    clientY: first.y,
  });

  for (const pt of rest) {
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: pt.x,
      clientY: pt.y,
    });
  }

  const last = rest[rest.length - 1] ?? first;
  fireEvent.pointerUp(canvas, {
    pointerId: 1,
    clientX: last.x,
    clientY: last.y,
  });
}

// ─── 1. Renders without error ──────────────────────────────────────────────────

describe("SignatureCapture — initial render", () => {
  it("renders without throwing", () => {
    expect(() => render(<SignatureCapture />)).not.toThrow();
  });

  it("renders the root element with default testId", () => {
    render(<SignatureCapture />);
    expect(screen.getByTestId("signature-capture")).toBeTruthy();
  });

  it("renders the canvas element", () => {
    render(<SignatureCapture />);
    expect(screen.getByTestId("signature-capture-canvas")).toBeTruthy();
  });

  it("renders undo and clear control buttons", () => {
    render(<SignatureCapture />);
    expect(screen.getByTestId("signature-capture-undo")).toBeTruthy();
    expect(screen.getByTestId("signature-capture-clear")).toBeTruthy();
  });

  it("renders the stroke-count indicator", () => {
    render(<SignatureCapture />);
    expect(screen.getByTestId("signature-capture-stroke-count")).toBeTruthy();
  });
});

// ─── 2. Placeholder visibility ────────────────────────────────────────────────

describe("SignatureCapture — placeholder", () => {
  it("shows placeholder when canvas is empty", () => {
    render(<SignatureCapture />);
    expect(screen.getByTestId("signature-capture-placeholder")).toBeTruthy();
  });

  it("hides placeholder after a stroke is drawn", () => {
    render(<SignatureCapture />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    drawStroke(canvas);

    expect(screen.queryByTestId("signature-capture-placeholder")).toBeNull();
  });

  it("shows default placeholder text 'Sign here'", () => {
    render(<SignatureCapture />);
    expect(screen.getByText("Sign here")).toBeTruthy();
  });
});

// ─── 3. Undo button disabled / enabled state ──────────────────────────────────

describe("SignatureCapture — undo button state", () => {
  it("undo is disabled when canvas is empty", () => {
    render(<SignatureCapture />);
    const undoBtn = screen.getByTestId("signature-capture-undo") as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
  });

  it("undo is enabled after a stroke is drawn", () => {
    render(<SignatureCapture />);
    const canvas  = screen.getByTestId("signature-capture-canvas");
    const undoBtn = screen.getByTestId("signature-capture-undo") as HTMLButtonElement;

    drawStroke(canvas);

    expect(undoBtn.disabled).toBe(false);
  });

  it("undo becomes disabled again when the last stroke is undone", () => {
    render(<SignatureCapture />);
    const canvas  = screen.getByTestId("signature-capture-canvas");
    const undoBtn = screen.getByTestId("signature-capture-undo") as HTMLButtonElement;

    drawStroke(canvas);
    expect(undoBtn.disabled).toBe(false);

    fireEvent.click(undoBtn);
    expect(undoBtn.disabled).toBe(true);
  });
});

// ─── 4. Clear button disabled / enabled state ─────────────────────────────────

describe("SignatureCapture — clear button state", () => {
  it("clear is disabled when canvas is empty", () => {
    render(<SignatureCapture />);
    const clearBtn = screen.getByTestId("signature-capture-clear") as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(true);
  });

  it("clear is enabled after a stroke is drawn", () => {
    render(<SignatureCapture />);
    const canvas   = screen.getByTestId("signature-capture-canvas");
    const clearBtn = screen.getByTestId("signature-capture-clear") as HTMLButtonElement;

    drawStroke(canvas);

    expect(clearBtn.disabled).toBe(false);
  });

  it("clear becomes disabled again after clicking clear", () => {
    render(<SignatureCapture />);
    const canvas   = screen.getByTestId("signature-capture-canvas");
    const clearBtn = screen.getByTestId("signature-capture-clear") as HTMLButtonElement;

    drawStroke(canvas);
    expect(clearBtn.disabled).toBe(false);

    fireEvent.click(clearBtn);
    expect(clearBtn.disabled).toBe(true);
  });
});

// ─── 5. Stroke count indicator ────────────────────────────────────────────────

describe("SignatureCapture — stroke count", () => {
  it("shows 'No signature' when empty", () => {
    render(<SignatureCapture />);
    expect(screen.getByTestId("signature-capture-stroke-count").textContent).toBe("No signature");
  });

  it("shows '1 stroke' after one stroke", () => {
    render(<SignatureCapture />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    drawStroke(canvas);

    expect(screen.getByTestId("signature-capture-stroke-count").textContent).toBe("1 stroke");
  });

  it("shows '2 strokes' after two strokes (plural)", () => {
    render(<SignatureCapture />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    drawStroke(canvas);
    drawStroke(canvas);

    expect(screen.getByTestId("signature-capture-stroke-count").textContent).toBe("2 strokes");
  });

  it("decrements to '1 stroke' after undo from 2 strokes", () => {
    render(<SignatureCapture />);
    const canvas  = screen.getByTestId("signature-capture-canvas");
    const undoBtn = screen.getByTestId("signature-capture-undo");

    drawStroke(canvas);
    drawStroke(canvas);
    fireEvent.click(undoBtn);

    expect(screen.getByTestId("signature-capture-stroke-count").textContent).toBe("1 stroke");
  });

  it("resets to 'No signature' after clear", () => {
    render(<SignatureCapture />);
    const canvas   = screen.getByTestId("signature-capture-canvas");
    const clearBtn = screen.getByTestId("signature-capture-clear");

    drawStroke(canvas);
    fireEvent.click(clearBtn);

    expect(screen.getByTestId("signature-capture-stroke-count").textContent).toBe("No signature");
  });
});

// ─── 6. Canvas aria-label ─────────────────────────────────────────────────────

describe("SignatureCapture — canvas aria-label", () => {
  it("canvas aria-label contains '(empty)' when no strokes", () => {
    render(<SignatureCapture />);
    const canvas = screen.getByTestId("signature-capture-canvas");
    expect(canvas.getAttribute("aria-label")).toContain("(empty)");
  });

  it("canvas aria-label contains '(contains signature)' after a stroke", () => {
    render(<SignatureCapture />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    drawStroke(canvas);

    expect(canvas.getAttribute("aria-label")).toContain("(contains signature)");
  });

  it("canvas aria-label uses default base: 'Signature drawing area'", () => {
    render(<SignatureCapture />);
    const canvas = screen.getByTestId("signature-capture-canvas");
    expect(canvas.getAttribute("aria-label")).toContain("Signature drawing area");
  });
});

// ─── 7. onChange called with data URL after stroke commit ─────────────────────

describe("SignatureCapture — onChange callback", () => {
  it("onChange is called with a data URL string after a stroke is committed", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    drawStroke(canvas);

    expect(onChange).toHaveBeenCalledWith("data:image/png;base64,MOCK_DATA");
  });

  it("onChange is not called on pointer-move alone (only on pointer-up)", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    // No pointer-up — stroke not committed yet
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── 8. onChange called with null after clear ─────────────────────────────────

describe("SignatureCapture — onChange after clear", () => {
  it("onChange called with null after clear", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas   = screen.getByTestId("signature-capture-canvas");
    const clearBtn = screen.getByTestId("signature-capture-clear");

    drawStroke(canvas);
    onChange.mockClear(); // reset to only check the clear call

    fireEvent.click(clearBtn);

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ─── 9. onChange called with null after undo empties strokes ──────────────────

describe("SignatureCapture — onChange after undo (empty result)", () => {
  it("onChange called with null when undo removes the last stroke", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas  = screen.getByTestId("signature-capture-canvas");
    const undoBtn = screen.getByTestId("signature-capture-undo");

    drawStroke(canvas);
    onChange.mockClear();

    fireEvent.click(undoBtn);

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

// ─── 10. onChange called with data URL after undo leaves remaining strokes ─────

describe("SignatureCapture — onChange after undo (strokes remain)", () => {
  it("onChange called with data URL when undo leaves remaining strokes", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas  = screen.getByTestId("signature-capture-canvas");
    const undoBtn = screen.getByTestId("signature-capture-undo");

    drawStroke(canvas);
    drawStroke(canvas);
    onChange.mockClear();

    fireEvent.click(undoBtn);

    expect(onChange).toHaveBeenCalledWith("data:image/png;base64,MOCK_DATA");
  });
});

// ─── 11. Undo decrements stroke count by exactly 1 ───────────────────────────

describe("SignatureCapture — undo stroke count", () => {
  it("undoing from 3 strokes yields 2", () => {
    render(<SignatureCapture />);
    const canvas  = screen.getByTestId("signature-capture-canvas");
    const undoBtn = screen.getByTestId("signature-capture-undo");

    drawStroke(canvas);
    drawStroke(canvas);
    drawStroke(canvas);
    fireEvent.click(undoBtn);

    expect(screen.getByTestId("signature-capture-stroke-count").textContent).toBe("2 strokes");
  });
});

// ─── 12. Clear resets stroke count to 0 ──────────────────────────────────────

describe("SignatureCapture — clear stroke count", () => {
  it("clear from 3 strokes yields 0", () => {
    render(<SignatureCapture />);
    const canvas   = screen.getByTestId("signature-capture-canvas");
    const clearBtn = screen.getByTestId("signature-capture-clear");

    drawStroke(canvas);
    drawStroke(canvas);
    drawStroke(canvas);
    fireEvent.click(clearBtn);

    expect(screen.getByTestId("signature-capture-stroke-count").textContent).toBe("No signature");
  });
});

// ─── 13. disabled prop: controls disabled ────────────────────────────────────

describe("SignatureCapture — disabled prop", () => {
  it("undo button is disabled when disabled=true regardless of strokes", () => {
    // We cannot draw when disabled, so just verify the button attribute.
    const { rerender } = render(<SignatureCapture />);
    // Manually set strokes would require internal state access — instead,
    // just verify that when disabled prop is true, buttons start disabled.
    rerender(<SignatureCapture disabled />);

    const undoBtn  = screen.getByTestId("signature-capture-undo")  as HTMLButtonElement;
    const clearBtn = screen.getByTestId("signature-capture-clear") as HTMLButtonElement;

    expect(undoBtn.disabled).toBe(true);
    expect(clearBtn.disabled).toBe(true);
  });

  it("does not call onChange when disabled and pointer events fire", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} disabled />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    // Attempting to draw on a disabled canvas should not call onChange
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(canvas,   { pointerId: 1, clientX: 20, clientY: 20 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("canvas has tabIndex=-1 when disabled", () => {
    render(<SignatureCapture disabled />);
    const canvas = screen.getByTestId("signature-capture-canvas");
    expect(canvas.getAttribute("tabindex")).toBe("-1");
  });
});

// ─── 14. Keyboard Delete clears the signature ─────────────────────────────────

describe("SignatureCapture — keyboard shortcut Delete", () => {
  it("Delete key clears all strokes", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas   = screen.getByTestId("signature-capture-canvas");
    const clearBtn = screen.getByTestId("signature-capture-clear") as HTMLButtonElement;

    drawStroke(canvas);
    expect(clearBtn.disabled).toBe(false);

    onChange.mockClear();
    fireEvent.keyDown(canvas, { key: "Delete" });

    expect(onChange).toHaveBeenCalledWith(null);
    expect(clearBtn.disabled).toBe(true);
  });

  it("Backspace key clears all strokes", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    drawStroke(canvas);
    onChange.mockClear();
    fireEvent.keyDown(canvas, { key: "Backspace" });

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

// ─── 15. Keyboard Ctrl+Z undoes ───────────────────────────────────────────────

describe("SignatureCapture — keyboard shortcut Ctrl+Z", () => {
  it("Ctrl+Z undoes the last stroke", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    drawStroke(canvas);
    drawStroke(canvas);
    onChange.mockClear();

    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });

    expect(onChange).toHaveBeenCalledWith("data:image/png;base64,MOCK_DATA");
    expect(
      screen.getByTestId("signature-capture-stroke-count").textContent
    ).toBe("1 stroke");
  });
});

// ─── 16. Keyboard Cmd+Z (macOS) undoes ────────────────────────────────────────

describe("SignatureCapture — keyboard shortcut Cmd+Z (macOS)", () => {
  it("Cmd+Z undoes the last stroke", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    drawStroke(canvas);
    onChange.mockClear();

    fireEvent.keyDown(canvas, { key: "z", metaKey: true });

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

// ─── 17. Multiple strokes accumulate ─────────────────────────────────────────

describe("SignatureCapture — multiple strokes", () => {
  it("each pointer-down/up cycle adds one stroke", () => {
    render(<SignatureCapture />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    drawStroke(canvas);
    drawStroke(canvas);
    drawStroke(canvas);

    expect(screen.getByTestId("signature-capture-stroke-count").textContent).toBe("3 strokes");
  });

  it("data-empty attribute is removed after the first stroke", () => {
    render(<SignatureCapture />);
    const root   = screen.getByTestId("signature-capture");
    const canvas = screen.getByTestId("signature-capture-canvas");

    expect(root.getAttribute("data-empty")).toBe("true");
    drawStroke(canvas);
    expect(root.getAttribute("data-empty")).toBeNull();
  });
});

// ─── 18. Custom placeholder text ─────────────────────────────────────────────

describe("SignatureCapture — custom placeholder", () => {
  it("renders custom placeholder text", () => {
    render(<SignatureCapture placeholder="Draw your signature" />);
    expect(screen.getByText("Draw your signature")).toBeTruthy();
  });
});

// ─── 19. Custom ariaLabel ─────────────────────────────────────────────────────

describe("SignatureCapture — custom ariaLabel", () => {
  it("custom ariaLabel is reflected in canvas aria-label", () => {
    render(<SignatureCapture ariaLabel="Recipient signature" />);
    const canvas = screen.getByTestId("signature-capture-canvas");
    expect(canvas.getAttribute("aria-label")).toContain("Recipient signature");
  });
});

// ─── 20. Custom height ────────────────────────────────────────────────────────

describe("SignatureCapture — custom height", () => {
  it("canvas wrap has the specified height style", () => {
    render(<SignatureCapture height={300} />);
    // The canvas wrap is the sibling of the controls, inside the root.
    // Since we can't query by CSS class in these tests, query by the
    // canvas element's parent.
    const canvas    = screen.getByTestId("signature-capture-canvas");
    const canvasWrap = canvas.parentElement as HTMLElement;
    expect(canvasWrap.style.height).toBe("300px");
  });
});

// ─── 21. Custom testId ────────────────────────────────────────────────────────

describe("SignatureCapture — custom testId", () => {
  it("custom testId is used as prefix for all child testIds", () => {
    render(<SignatureCapture testId="my-sig" />);
    expect(screen.getByTestId("my-sig")).toBeTruthy();
    expect(screen.getByTestId("my-sig-canvas")).toBeTruthy();
    expect(screen.getByTestId("my-sig-undo")).toBeTruthy();
    expect(screen.getByTestId("my-sig-clear")).toBeTruthy();
    expect(screen.getByTestId("my-sig-stroke-count")).toBeTruthy();
  });
});

// ─── 22. Pointer cancel clears in-progress stroke ─────────────────────────────

describe("SignatureCapture — pointer cancel", () => {
  it("pointer cancel does not commit the in-progress stroke", () => {
    const onChange = vi.fn();
    render(<SignatureCapture onChange={onChange} />);
    const canvas = screen.getByTestId("signature-capture-canvas");

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 50, clientY: 50 });
    // Cancel — simulates phone call interrupting the gesture
    fireEvent.pointerCancel(canvas, { pointerId: 1 });

    // onChange should NOT be called (stroke was cancelled, not committed)
    expect(onChange).not.toHaveBeenCalled();
    // Canvas should still be empty
    expect(
      screen.getByTestId("signature-capture-stroke-count").textContent
    ).toBe("No signature");
  });
});

// ─── 23. canvas role and tabIndex ─────────────────────────────────────────────

describe("SignatureCapture — ARIA roles", () => {
  it("canvas has role='img'", () => {
    render(<SignatureCapture />);
    const canvas = screen.getByTestId("signature-capture-canvas");
    expect(canvas.getAttribute("role")).toBe("img");
  });

  it("canvas has tabIndex=0 by default (focusable)", () => {
    render(<SignatureCapture />);
    const canvas = screen.getByTestId("signature-capture-canvas");
    expect(canvas.getAttribute("tabindex")).toBe("0");
  });

  it("controls group has role='group' with aria-label", () => {
    render(<SignatureCapture />);
    const group = screen.getByRole("group", { name: /signature controls/i });
    expect(group).toBeTruthy();
  });
});
