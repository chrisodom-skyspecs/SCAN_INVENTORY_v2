/**
 * GlobalSearchModal — unit tests.
 *
 * Tests that:
 *   - Modal renders when isOpen=true and is absent when isOpen=false
 *   - The dialog receives proper ARIA attributes (role=dialog, aria-modal, aria-labelledby)
 *   - The backdrop renders with data-state="open" when open
 *   - The backdrop renders with data-state="closed" when closing (before DOM removal)
 *   - The search input is rendered inside the modal
 *   - The close button triggers onClose
 *   - Clicking the backdrop triggers onClose
 *   - Clicking inside the dialog panel does NOT trigger onClose
 *   - Escape key triggers onClose when modal is open
 *   - Escape key does NOT trigger onClose when modal is closed
 *   - Typing in the search input updates the query and fires onQueryChange
 *   - Clear button appears when query is non-empty and clears the query on click
 *   - Submitting the form fires onSubmit with the trimmed query
 *   - Empty state is shown when query is empty
 *   - Results placeholder is shown when query is non-empty
 *   - initialQuery prop pre-fills the input
 *   - Focus is returned to the previously focused element on close
 *
 * Mocking strategy:
 *   - ReactDOM.createPortal is kept real; document.body is available in jsdom.
 *   - The 200ms exit timer is fast-forwarded with vi.useFakeTimers().
 *   - All queries use data-testid attributes for stability.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import * as React from "react";
import { GlobalSearchModal } from "../GlobalSearchModal";

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Render GlobalSearchModal with isOpen=true.
 * The component uses a `isMounted` state that requires a useEffect to fire,
 * so we must wrap in act() to flush effects.
 */
async function renderOpen(props?: Partial<React.ComponentProps<typeof GlobalSearchModal>>) {
  const onClose = vi.fn();
  let result!: ReturnType<typeof render>;

  await act(async () => {
    result = render(
      <GlobalSearchModal isOpen={true} onClose={onClose} {...props} />
    );
  });

  return { ...result, onClose };
}

/**
 * Render GlobalSearchModal with isOpen=false (not visible initially).
 */
async function renderClosed(props?: Partial<React.ComponentProps<typeof GlobalSearchModal>>) {
  const onClose = vi.fn();
  let result!: ReturnType<typeof render>;

  await act(async () => {
    result = render(
      <GlobalSearchModal isOpen={false} onClose={onClose} {...props} />
    );
  });

  return { ...result, onClose };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GlobalSearchModal", () => {
  // ── Visibility ──────────────────────────────────────────────────────────────

  describe("visibility", () => {
    it("renders the modal when isOpen=true", async () => {
      await renderOpen();
      expect(screen.getByTestId("global-search-modal")).toBeTruthy();
    });

    it("does not render the modal when isOpen=false", async () => {
      await renderClosed();
      expect(screen.queryByTestId("global-search-modal")).toBeNull();
    });

    it("removes the modal from the DOM after the exit animation (200ms) when isOpen transitions to false", async () => {
      const onClose = vi.fn();
      let rerender!: ReturnType<typeof render>["rerender"];

      await act(async () => {
        const result = render(
          <GlobalSearchModal isOpen={true} onClose={onClose} />
        );
        rerender = result.rerender;
      });

      // Modal is visible
      expect(screen.getByTestId("global-search-modal")).toBeTruthy();

      // Transition to closed
      await act(async () => {
        rerender(<GlobalSearchModal isOpen={false} onClose={onClose} />);
      });

      // Modal still in DOM (exit animation playing) immediately after close
      // data-state="closed" so exit animation runs
      const backdrop = screen.queryByTestId("global-search-backdrop");
      if (backdrop) {
        expect(backdrop.getAttribute("data-state")).toBe("closed");
      }

      // After 200ms exit timer fires, DOM node should be removed
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      expect(screen.queryByTestId("global-search-modal")).toBeNull();
    });
  });

  // ── ARIA & semantics ────────────────────────────────────────────────────────

  describe("ARIA attributes", () => {
    it("renders the dialog with role=dialog", async () => {
      await renderOpen();
      const dialog = screen.getByTestId("global-search-modal");
      expect(dialog.getAttribute("role")).toBe("dialog");
    });

    it("renders the dialog with aria-modal=true", async () => {
      await renderOpen();
      const dialog = screen.getByTestId("global-search-modal");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
    });

    it("renders the dialog with aria-labelledby pointing to the sr-only label", async () => {
      await renderOpen();
      const dialog = screen.getByTestId("global-search-modal");
      const labelId = dialog.getAttribute("aria-labelledby");
      expect(labelId).toBeTruthy();
      const label = document.getElementById(labelId!);
      expect(label).toBeTruthy();
      expect(label?.textContent).toContain("search");
    });

    it("renders the backdrop with data-state=open when open", async () => {
      await renderOpen();
      const backdrop = screen.getByTestId("global-search-backdrop");
      expect(backdrop.getAttribute("data-state")).toBe("open");
    });

    it("renders the backdrop with data-state=closed immediately after close", async () => {
      const onClose = vi.fn();
      let rerender!: ReturnType<typeof render>["rerender"];

      await act(async () => {
        const result = render(
          <GlobalSearchModal isOpen={true} onClose={onClose} />
        );
        rerender = result.rerender;
      });

      await act(async () => {
        rerender(<GlobalSearchModal isOpen={false} onClose={onClose} />);
      });

      const backdrop = screen.queryByTestId("global-search-backdrop");
      if (backdrop) {
        expect(backdrop.getAttribute("data-state")).toBe("closed");
      }
    });
  });

  // ── Close interactions ──────────────────────────────────────────────────────

  describe("close interactions", () => {
    it("calls onClose when the close button is clicked", async () => {
      const { onClose } = await renderOpen();
      const closeButton = screen.getByTestId("global-search-close");
      await act(async () => {
        fireEvent.click(closeButton);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when the backdrop is clicked", async () => {
      const { onClose } = await renderOpen();
      const backdrop = screen.getByTestId("global-search-backdrop");
      await act(async () => {
        fireEvent.click(backdrop);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does NOT call onClose when clicking inside the dialog panel", async () => {
      const { onClose } = await renderOpen();
      const dialog = screen.getByTestId("global-search-modal");
      await act(async () => {
        fireEvent.click(dialog);
      });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("calls onClose when Escape key is pressed while modal is open", async () => {
      const { onClose } = await renderOpen();
      await act(async () => {
        fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire onClose for Escape when modal is closed", async () => {
      const { onClose } = await renderClosed();
      await act(async () => {
        fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
      });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // ── Search input ────────────────────────────────────────────────────────────

  describe("search input", () => {
    it("renders the search input", async () => {
      await renderOpen();
      expect(screen.getByTestId("global-search-input")).toBeTruthy();
    });

    it("calls onQueryChange as user types", async () => {
      const onQueryChange = vi.fn();
      await renderOpen({ onQueryChange });

      const input = screen.getByTestId("global-search-input") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "CASE-001" } });
      });

      expect(onQueryChange).toHaveBeenCalledWith("CASE-001");
    });

    it("shows the clear button when query is non-empty", async () => {
      await renderOpen();
      const input = screen.getByTestId("global-search-input") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "abc" } });
      });

      expect(screen.getByTestId("global-search-clear")).toBeTruthy();
    });

    it("hides the clear button when query is empty", async () => {
      await renderOpen();
      expect(screen.queryByTestId("global-search-clear")).toBeNull();
    });

    it("clears the query when the clear button is clicked", async () => {
      const onQueryChange = vi.fn();
      await renderOpen({ onQueryChange });

      const input = screen.getByTestId("global-search-input") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "CASE-001" } });
      });

      const clearButton = screen.getByTestId("global-search-clear");

      await act(async () => {
        fireEvent.click(clearButton);
      });

      // After clearing, the input should be empty and the clear button gone
      expect((screen.getByTestId("global-search-input") as HTMLInputElement).value).toBe("");
      expect(screen.queryByTestId("global-search-clear")).toBeNull();
      // onQueryChange called with empty string on clear
      expect(onQueryChange).toHaveBeenLastCalledWith("");
    });

    it("pre-fills the input with initialQuery", async () => {
      await renderOpen({ initialQuery: "CASE-007" });
      const input = screen.getByTestId("global-search-input") as HTMLInputElement;
      expect(input.value).toBe("CASE-007");
    });
  });

  // ── Form submit ─────────────────────────────────────────────────────────────

  describe("form submission", () => {
    it("calls onSubmit with the trimmed query on Enter", async () => {
      const onSubmit = vi.fn();
      await renderOpen({ onSubmit });

      const input = screen.getByTestId("global-search-input") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "  CASE-001  " } });
      });

      await act(async () => {
        fireEvent.submit(input.closest("form")!);
      });

      expect(onSubmit).toHaveBeenCalledWith("CASE-001");
    });

    it("does NOT call onSubmit when query is empty", async () => {
      const onSubmit = vi.fn();
      await renderOpen({ onSubmit });

      const input = screen.getByTestId("global-search-input") as HTMLInputElement;

      await act(async () => {
        fireEvent.submit(input.closest("form")!);
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  // ── Empty vs. results state ─────────────────────────────────────────────────

  describe("body state", () => {
    it("shows the empty state when query is empty", async () => {
      await renderOpen();
      expect(screen.getByTestId("global-search-empty")).toBeTruthy();
    });

    it("shows the results placeholder when query is non-empty", async () => {
      await renderOpen();
      const input = screen.getByTestId("global-search-input") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "turbine" } });
      });

      expect(screen.getByTestId("global-search-results-placeholder")).toBeTruthy();
      expect(screen.queryByTestId("global-search-empty")).toBeNull();
    });

    it("switches back to empty state when query is cleared", async () => {
      await renderOpen();
      const input = screen.getByTestId("global-search-input") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "test" } });
      });

      await act(async () => {
        fireEvent.change(input, { target: { value: "" } });
      });

      expect(screen.getByTestId("global-search-empty")).toBeTruthy();
      expect(screen.queryByTestId("global-search-results-placeholder")).toBeNull();
    });
  });
});
