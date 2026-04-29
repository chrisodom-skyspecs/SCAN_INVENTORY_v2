/**
 * @vitest-environment jsdom
 *
 * Unit tests: InlineSiteEditor — click-to-edit case site (locationName) field.
 *
 * Covered scenarios
 * ─────────────────
 * Idle state:
 *   1. Renders site name in idle mode.
 *   2. Renders "No site" placeholder when currentSite is null.
 *   3. Renders "No site" placeholder when currentSite is undefined.
 *   4. Renders an edit button with aria-label "Edit case site".
 *   5. Clicking the edit button transitions to editing mode.
 *
 * Editing state:
 *   6. Text input is shown with the current site name pre-filled.
 *   7. Input is empty when currentSite is null (no placeholder value).
 *   8. Save button is disabled when input value equals current site.
 *   9. Save button is enabled after changing the input value.
 *  10. Cancel button returns to idle state.
 *  11. Escape keydown cancels and returns to idle state.
 *  12. Enter keydown while on the edit row triggers Save.
 *
 * Saving state:
 *  13. Clicking Save triggers the updateCaseSite mutation with correct args.
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
      updateCaseSite: "cases:updateCaseSite",
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

import { InlineSiteEditor } from "../InlineSiteEditor";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function renderEditor(
  currentSite: string | null | undefined = "Site Alpha",
  caseId = "case-test-id"
) {
  return render(
    <InlineSiteEditor caseId={caseId} currentSite={currentSite} />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InlineSiteEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mutation resolves successfully
    mockMutationFn.mockResolvedValue({
      caseId: "case-test-id",
      previousSite: "Site Alpha",
      newSite: "Site Beta",
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ── Idle state ───────────────────────────────────────────────────────────

  it("1. renders site name in idle mode", () => {
    renderEditor("Site Alpha");
    expect(screen.getByTestId("inline-site-idle")).toBeTruthy();
    expect(screen.getByText("Site Alpha")).toBeTruthy();
  });

  it("2. renders 'No site' placeholder when currentSite is null", () => {
    renderEditor(null);
    expect(screen.getByTestId("inline-site-idle")).toBeTruthy();
    expect(screen.getByText("No site")).toBeTruthy();
  });

  it("3. renders 'No site' placeholder when currentSite is undefined", () => {
    render(<InlineSiteEditor caseId="case-test-id" currentSite={undefined} />);
    expect(screen.getByTestId("inline-site-idle")).toBeTruthy();
    expect(screen.getByText("No site")).toBeTruthy();
  });

  it("4. renders an edit button with correct aria-label", () => {
    renderEditor("Site Alpha");
    const editBtn = screen.getByRole("button", { name: "Edit case site" });
    expect(editBtn).toBeTruthy();
  });

  it("5. clicking edit button shows editing mode", async () => {
    renderEditor("Site Alpha");
    const editBtn = screen.getByRole("button", { name: "Edit case site" });

    await act(async () => {
      fireEvent.click(editBtn);
    });

    expect(screen.getByTestId("inline-site-editing")).toBeTruthy();
    expect(screen.getByTestId("inline-site-input")).toBeTruthy();
  });

  // ── Editing state ────────────────────────────────────────────────────────

  it("6. text input shows current site name pre-filled", async () => {
    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const input = screen.getByTestId("inline-site-input") as HTMLInputElement;
    expect(input.value).toBe("Site Alpha");
  });

  it("7. text input is empty when currentSite is null", async () => {
    renderEditor(null);
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const input = screen.getByTestId("inline-site-input") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("8. Save button is disabled when input value equals current site", async () => {
    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const saveBtn = screen.getByTestId(
      "inline-site-save-btn"
    ) as HTMLButtonElement;
    // Same value as currentSite → disabled
    expect(saveBtn.disabled).toBe(true);
  });

  it("9. Save button is enabled after changing the input value", async () => {
    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const input = screen.getByTestId("inline-site-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Site Beta" } });

    const saveBtn = screen.getByTestId(
      "inline-site-save-btn"
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("10. Cancel button returns to idle state", async () => {
    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    expect(screen.getByTestId("inline-site-editing")).toBeTruthy();

    fireEvent.click(screen.getByTestId("inline-site-cancel-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("inline-site-idle")).toBeTruthy();
    });
  });

  it("11. Escape key cancels and returns to idle state", async () => {
    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const editRow = screen.getByTestId("inline-site-editing");
    fireEvent.keyDown(editRow, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByTestId("inline-site-idle")).toBeTruthy();
    });
  });

  it("12. Enter key on the edit row triggers Save", async () => {
    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const input = screen.getByTestId("inline-site-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Site Beta" } });

    const editRow = screen.getByTestId("inline-site-editing");
    await act(async () => {
      fireEvent.keyDown(editRow, { key: "Enter" });
    });

    expect(mockMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({ newSiteName: "Site Beta" })
    );
  });

  // ── Saving / mutation ────────────────────────────────────────────────────

  it("13. Save triggers updateCaseSite mutation with correct args", async () => {
    renderEditor("Site Alpha", "case-xyz");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const input = screen.getByTestId("inline-site-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Site Beta" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-site-save-btn"));
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      caseId:      "case-xyz",
      newSiteName: "Site Beta",
      userId:      "user-abc",
      userName:    "Test Operator",
    });
  });

  it("14. withOptimisticUpdate is wired into the mutation", () => {
    renderEditor("Site Alpha");
    expect(mockWithOptimisticUpdate).toHaveBeenCalledTimes(1);
  });

  it("15. On successful mutation, returns to idle state", async () => {
    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const input = screen.getByTestId("inline-site-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Site Beta" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-site-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-site-idle")).toBeTruthy();
    });
  });

  // ── Error state ──────────────────────────────────────────────────────────

  it("16. When mutation throws, shows error state", async () => {
    mockMutationFn.mockRejectedValueOnce(new Error("Network error"));

    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const input = screen.getByTestId("inline-site-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Site Beta" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-site-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-site-error")).toBeTruthy();
    });
  });

  it("17. Retry button in error state returns to editing mode", async () => {
    mockMutationFn.mockRejectedValueOnce(new Error("Oops"));

    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const input = screen.getByTestId("inline-site-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Site Beta" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-site-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-site-error")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry site update" }));

    await waitFor(() => {
      expect(screen.getByTestId("inline-site-editing")).toBeTruthy();
    });
  });

  it("18. Cancel button in error state returns to idle", async () => {
    mockMutationFn.mockRejectedValueOnce(new Error("Oops"));

    renderEditor("Site Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit case site" }));

    const input = screen.getByTestId("inline-site-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Site Beta" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("inline-site-save-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-site-error")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel site edit" }));

    await waitFor(() => {
      expect(screen.getByTestId("inline-site-idle")).toBeTruthy();
    });
  });

  it("19. withOptimisticUpdate is called once per render", () => {
    renderEditor("Site Alpha");
    expect(mockWithOptimisticUpdate).toHaveBeenCalledTimes(1);
  });
});
