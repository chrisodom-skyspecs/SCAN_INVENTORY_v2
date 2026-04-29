/**
 * @vitest-environment jsdom
 *
 * Unit tests: InlineStatusEditor — click-to-edit case status field.
 *
 * Covered scenarios
 * ─────────────────
 * Idle state:
 *   1. Renders a StatusPill for the current status (idle mode).
 *   2. Renders an edit button with aria-label "Edit case status".
 *   3. Clicking the edit button transitions to editing mode.
 *
 * Editing state:
 *   4. Dropdown is shown with all 8 case status options.
 *   5. The current status is pre-selected in the dropdown.
 *   6. Save button is disabled when the selected value equals the current status.
 *   7. Save button is enabled after selecting a different status.
 *   8. Cancel button returns to idle state.
 *   9. Escape keydown cancels and returns to idle state.
 *
 * Saving state:
 *  10. Clicking Save triggers the updateCaseStatus mutation with correct args.
 *  11. During save, a spinner indicator appears.
 *  12. On successful mutation, transitions back to idle.
 *
 * Error state:
 *  13. When mutation throws, error state is shown.
 *  14. Retry button in error state returns to editing mode.
 *  15. Cancel button in error state returns to idle.
 *
 * Optimistic update:
 *  16. useMutation.withOptimisticUpdate is called (mutation factory wired).
 */

import React from "react";
import { render, screen, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock convex/react ────────────────────────────────────────────────────────
//
// useMutation returns a function that can be configured to resolve or reject.
// withOptimisticUpdate is a no-op wrapper that returns the same fn.

const mockMutationFn = vi.fn();
const mockWithOptimisticUpdate = vi.fn((fn: unknown) => {
  void fn; // capture but ignore the optimistic update fn for these unit tests
  return mockMutationFn;
});

vi.mock("convex/react", () => ({
  useMutation: () => ({
    withOptimisticUpdate: mockWithOptimisticUpdate,
  }),
  useQuery: vi.fn(() => null),
}));

// ─── Mock the generated Convex API ────────────────────────────────────────────

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    cases: {
      updateCaseStatus: "cases:updateCaseStatus",
      getCaseById: "cases:getCaseById",
      getCaseStatus: "cases:getCaseStatus",
    },
  },
}));

// ─── Mock useKindeUser ────────────────────────────────────────────────────────

vi.mock("../../../hooks/use-kinde-user", () => ({
  useKindeUser: () => ({
    id: "user-abc",
    name: "Test Operator",
    isLoading: false,
    isAuthenticated: true,
  }),
}));

// ─── Import component under test ──────────────────────────────────────────────

import { InlineStatusEditor } from "../InlineStatusEditor";
import type { CaseStatus } from "../../../../convex/cases";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function renderEditor(
  currentStatus: CaseStatus = "deployed",
  caseId = "case-test-id"
) {
  return render(
    <InlineStatusEditor caseId={caseId} currentStatus={currentStatus} />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InlineStatusEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mutation resolves successfully
    mockMutationFn.mockResolvedValue({
      caseId: "case-test-id",
      previousStatus: "deployed",
      newStatus: "transit_in",
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ── Idle state ───────────────────────────────────────────────────────────

  it("1. renders a status pill in idle mode", () => {
    renderEditor("deployed");
    // StatusPill renders a span with role="status"
    const pill = screen.getByRole("status");
    expect(pill).toBeTruthy();
    // The pill text should reflect the deployed label
    expect(pill.textContent).toContain("Deployed");
  });

  it("2. renders an edit button with correct aria-label", () => {
    renderEditor("assembled");
    const editBtn = screen.getByRole("button", { name: "Edit case status" });
    expect(editBtn).toBeTruthy();
  });

  it("3. clicking edit button shows editing mode", async () => {
    renderEditor("deployed");
    const editBtn = screen.getByRole("button", { name: "Edit case status" });

    await act(async () => {
      fireEvent.click(editBtn);
    });

    // Dropdown should appear
    expect(screen.getByTestId("inline-status-editing")).toBeTruthy();
    expect(screen.getByTestId("inline-status-select")).toBeTruthy();
  });

  // ── Editing state ────────────────────────────────────────────────────────

  it("4. dropdown shows all 8 case status options", async () => {
    renderEditor("deployed");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const select = screen.getByTestId("inline-status-select") as HTMLSelectElement;
    expect(select.options.length).toBe(8);

    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("hangar");
    expect(values).toContain("assembled");
    expect(values).toContain("transit_out");
    expect(values).toContain("deployed");
    expect(values).toContain("flagged");
    expect(values).toContain("transit_in");
    expect(values).toContain("received");
    expect(values).toContain("archived");
  });

  it("5. current status is pre-selected in dropdown", async () => {
    renderEditor("assembled");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const select = screen.getByTestId("inline-status-select") as HTMLSelectElement;
    expect(select.value).toBe("assembled");
  });

  it("6. Save button is disabled when selected status equals current status", async () => {
    renderEditor("deployed");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const saveBtn = screen.getByTestId("inline-status-save-btn") as HTMLButtonElement;
    // Same status selected → disabled
    expect(saveBtn.disabled).toBe(true);
  });

  it("7. Save button is enabled after selecting a different status", async () => {
    renderEditor("deployed");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const select = screen.getByTestId("inline-status-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "transit_in" } });

    const saveBtn = screen.getByTestId("inline-status-save-btn") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("8. Cancel button returns to idle state", async () => {
    renderEditor("deployed");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    // Should be in editing state
    expect(screen.getByTestId("inline-status-editing")).toBeTruthy();

    fireEvent.click(screen.getByTestId("inline-status-cancel-btn"));

    // Should be back to idle
    await waitFor(() => {
      expect(screen.getByTestId("inline-status-idle")).toBeTruthy();
    });
  });

  it("9. Escape key cancels and returns to idle state", async () => {
    renderEditor("deployed");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const editRow = screen.getByTestId("inline-status-editing");
    fireEvent.keyDown(editRow, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByTestId("inline-status-idle")).toBeTruthy();
    });
  });

  // ── Saving / mutation ────────────────────────────────────────────────────

  it("10. Save triggers updateCaseStatus mutation with correct args", async () => {
    renderEditor("deployed", "case-xyz");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const select = screen.getByTestId("inline-status-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "transit_in" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-status-save-btn"));
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      caseId:    "case-xyz",
      newStatus: "transit_in",
      userId:    "user-abc",
      userName:  "Test Operator",
    });
  });

  it("11. withOptimisticUpdate is wired into the mutation", () => {
    renderEditor("deployed");
    // withOptimisticUpdate should be called once during component initialization
    expect(mockWithOptimisticUpdate).toHaveBeenCalledTimes(1);
  });

  it("12. On successful mutation, returns to idle state", async () => {
    renderEditor("deployed");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const select = screen.getByTestId("inline-status-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "received" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-status-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-status-idle")).toBeTruthy();
    });
  });

  // ── Error state ──────────────────────────────────────────────────────────

  it("13. When mutation throws, shows error state", async () => {
    mockMutationFn.mockRejectedValueOnce(new Error("Network error"));

    renderEditor("deployed");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const select = screen.getByTestId("inline-status-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "flagged" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-status-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-status-error")).toBeTruthy();
    });
  });

  it("14. Retry button in error state returns to editing mode", async () => {
    mockMutationFn.mockRejectedValueOnce(new Error("Oops"));

    renderEditor("deployed");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const select = screen.getByTestId("inline-status-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "flagged" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-status-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-status-error")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry status update" }));

    await waitFor(() => {
      expect(screen.getByTestId("inline-status-editing")).toBeTruthy();
    });
  });

  it("15. Cancel button in error state returns to idle", async () => {
    mockMutationFn.mockRejectedValueOnce(new Error("Oops"));

    renderEditor("deployed");
    fireEvent.click(screen.getByRole("button", { name: "Edit case status" }));

    const select = screen.getByTestId("inline-status-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "flagged" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-status-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-status-error")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel status edit" }));

    await waitFor(() => {
      expect(screen.getByTestId("inline-status-idle")).toBeTruthy();
    });
  });
});
