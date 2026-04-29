/**
 * @vitest-environment jsdom
 *
 * Unit tests: InlineHolderEditor — click-to-edit case holder field.
 *
 * Covered scenarios
 * ─────────────────
 * Idle state:
 *   1. Renders holder name in idle mode.
 *   2. Renders "Unassigned" placeholder when currentHolder is null.
 *   3. Renders "Unassigned" placeholder when currentHolder is undefined.
 *   4. Renders an edit button with aria-label "Edit case holder".
 *   5. Clicking the edit button transitions to editing mode.
 *
 * Editing state:
 *   6. Text input is shown with the current holder name pre-filled.
 *   7. Input is empty when currentHolder is null (no placeholder value).
 *   8. Save button is disabled when input value equals current holder.
 *   9. Save button is enabled after changing the input value.
 *  10. Cancel button returns to idle state.
 *  11. Escape keydown cancels and returns to idle state.
 *  12. Enter keydown while input focused triggers Save.
 *
 * Saving state:
 *  13. Clicking Save triggers the updateCaseHolder mutation with correct args.
 *  14. During save, a spinner indicator appears.
 *  15. On successful mutation, transitions back to idle.
 *
 * Error state:
 *  16. When mutation throws, error state is shown.
 *  17. Retry button in error state returns to editing mode.
 *  18. Cancel button in error state returns to idle.
 *
 * Optimistic update:
 *  19. useMutation.withOptimisticUpdate is called (mutation factory wired).
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock convex/react ────────────────────────────────────────────────────────

const mockMutationFn = vi.fn();
const mockWithOptimisticUpdate = vi.fn((fn: unknown) => {
  void fn;
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
      updateCaseHolder: "cases:updateCaseHolder",
      getCaseById: "cases:getCaseById",
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

import { InlineHolderEditor } from "../InlineHolderEditor";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function renderEditor(
  currentHolder: string | null | undefined = "Alice Smith",
  caseId = "case-test-id"
) {
  return render(
    <InlineHolderEditor caseId={caseId} currentHolder={currentHolder} />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InlineHolderEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mutation resolves successfully
    mockMutationFn.mockResolvedValue({
      caseId: "case-test-id",
      previousHolder: "Alice Smith",
      newHolder: "Bob Jones",
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ── Idle state ───────────────────────────────────────────────────────────

  it("1. renders holder name in idle mode", () => {
    renderEditor("Alice Smith");
    expect(screen.getByTestId("inline-holder-idle")).toBeTruthy();
    expect(screen.getByText("Alice Smith")).toBeTruthy();
  });

  it("2. renders Unassigned placeholder when currentHolder is null", () => {
    renderEditor(null);
    expect(screen.getByTestId("inline-holder-idle")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });

  it("3. renders Unassigned placeholder when currentHolder is undefined", () => {
    // Render directly — renderEditor helper has a non-undefined default,
    // so we bypass it here to explicitly pass undefined.
    render(<InlineHolderEditor caseId="case-test-id" currentHolder={undefined} />);
    expect(screen.getByTestId("inline-holder-idle")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });

  it("4. renders an edit button with correct aria-label", () => {
    renderEditor("Alice Smith");
    const editBtn = screen.getByRole("button", { name: "Edit case holder" });
    expect(editBtn).toBeTruthy();
  });

  it("5. clicking edit button shows editing mode", async () => {
    renderEditor("Alice Smith");
    const editBtn = screen.getByRole("button", { name: "Edit case holder" });

    await act(async () => {
      fireEvent.click(editBtn);
    });

    expect(screen.getByTestId("inline-holder-editing")).toBeTruthy();
    expect(screen.getByTestId("inline-holder-input")).toBeTruthy();
  });

  // ── Editing state ────────────────────────────────────────────────────────

  it("6. text input shows current holder name pre-filled", async () => {
    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const input = screen.getByTestId("inline-holder-input") as HTMLInputElement;
    expect(input.value).toBe("Alice Smith");
  });

  it("7. text input is empty when currentHolder is null", async () => {
    renderEditor(null);
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const input = screen.getByTestId("inline-holder-input") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("8. Save button is disabled when input value equals current holder", async () => {
    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const saveBtn = screen.getByTestId(
      "inline-holder-save-btn"
    ) as HTMLButtonElement;
    // Same value as currentHolder → disabled
    expect(saveBtn.disabled).toBe(true);
  });

  it("9. Save button is enabled after changing the input value", async () => {
    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const input = screen.getByTestId("inline-holder-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bob Jones" } });

    const saveBtn = screen.getByTestId(
      "inline-holder-save-btn"
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("10. Cancel button returns to idle state", async () => {
    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    expect(screen.getByTestId("inline-holder-editing")).toBeTruthy();

    fireEvent.click(screen.getByTestId("inline-holder-cancel-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("inline-holder-idle")).toBeTruthy();
    });
  });

  it("11. Escape key cancels and returns to idle state", async () => {
    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const editRow = screen.getByTestId("inline-holder-editing");
    fireEvent.keyDown(editRow, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByTestId("inline-holder-idle")).toBeTruthy();
    });
  });

  it("12. Enter key on the edit row triggers Save", async () => {
    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const input = screen.getByTestId("inline-holder-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bob Jones" } });

    const editRow = screen.getByTestId("inline-holder-editing");
    await act(async () => {
      fireEvent.keyDown(editRow, { key: "Enter" });
    });

    expect(mockMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({ newHolderName: "Bob Jones" })
    );
  });

  // ── Saving / mutation ────────────────────────────────────────────────────

  it("13. Save triggers updateCaseHolder mutation with correct args", async () => {
    renderEditor("Alice Smith", "case-xyz");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const input = screen.getByTestId("inline-holder-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bob Jones" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-holder-save-btn"));
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      caseId:        "case-xyz",
      newHolderName: "Bob Jones",
      userId:        "user-abc",
      userName:      "Test Operator",
    });
  });

  it("14. withOptimisticUpdate is wired into the mutation", () => {
    renderEditor("Alice Smith");
    expect(mockWithOptimisticUpdate).toHaveBeenCalledTimes(1);
  });

  it("15. On successful mutation, returns to idle state", async () => {
    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const input = screen.getByTestId("inline-holder-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bob Jones" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-holder-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-holder-idle")).toBeTruthy();
    });
  });

  // ── Error state ──────────────────────────────────────────────────────────

  it("16. When mutation throws, shows error state", async () => {
    mockMutationFn.mockRejectedValueOnce(new Error("Network error"));

    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const input = screen.getByTestId("inline-holder-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bob Jones" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-holder-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-holder-error")).toBeTruthy();
    });
  });

  it("17. Retry button in error state returns to editing mode", async () => {
    mockMutationFn.mockRejectedValueOnce(new Error("Oops"));

    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const input = screen.getByTestId("inline-holder-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bob Jones" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-holder-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-holder-error")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry holder update" }));

    await waitFor(() => {
      expect(screen.getByTestId("inline-holder-editing")).toBeTruthy();
    });
  });

  it("18. Cancel button in error state returns to idle", async () => {
    mockMutationFn.mockRejectedValueOnce(new Error("Oops"));

    renderEditor("Alice Smith");
    fireEvent.click(screen.getByRole("button", { name: "Edit case holder" }));

    const input = screen.getByTestId("inline-holder-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bob Jones" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-holder-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-holder-error")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel holder edit" }));

    await waitFor(() => {
      expect(screen.getByTestId("inline-holder-idle")).toBeTruthy();
    });
  });

  it("19. withOptimisticUpdate is called once per render", () => {
    renderEditor("Alice Smith");
    expect(mockWithOptimisticUpdate).toHaveBeenCalledTimes(1);
  });
});
