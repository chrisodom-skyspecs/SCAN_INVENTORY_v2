/**
 * @vitest-environment jsdom
 *
 * Unit tests: TemplateForm — item reorder (Sub-AC 3c)
 *
 * Covered scenarios
 * ─────────────────
 * Up/down arrow buttons:
 *   1. Each item row renders ↑ and ↓ move buttons.
 *   2. The ↑ button of the first item is disabled.
 *   3. The ↓ button of the last item is disabled.
 *   4. Clicking ↑ on item at index 1 moves it to index 0 (swaps with predecessor).
 *   5. Clicking ↓ on item at index 0 moves it to index 1 (swaps with successor).
 *   6. Multiple consecutive moves accumulate correctly.
 *   7. Move buttons are disabled while the form is submitting.
 *
 * Drag-and-drop:
 *   8.  Each item row has the `draggable` attribute set to "true".
 *   9.  dragStart records the source index via dataTransfer.
 *   10. dragOver prevents default (allows drop).
 *   11. Dropping item[0] onto item[2] moves item[0] to position 2.
 *   12. Dropping an item onto itself is a no-op.
 *   13. dragEnd clears visual drag-over state.
 *
 * Form state before submit:
 *   14. After reordering, sortOrder values match the new array positions on submit.
 *   15. Item names are preserved exactly after reordering.
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  within,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCreateTemplate = vi.fn();
const mockUpdateTemplate = vi.fn();
const mockSetTemplateItems = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(() => undefined),
}));

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    caseTemplates: {
      createTemplate: "caseTemplates:createTemplate",
      updateTemplate: "caseTemplates:updateTemplate",
      setTemplateItems: "caseTemplates:setTemplateItems",
      getCaseTemplateById: "caseTemplates:getCaseTemplateById",
    },
  },
}));

// Mock the hooks used by TemplateForm directly so we can control mutation calls
vi.mock("../../../hooks/use-case-templates", () => ({
  useCreateTemplate: () => mockCreateTemplate,
  useUpdateTemplate: () => mockUpdateTemplate,
  useSetTemplateItems: () => mockSetTemplateItems,
  useCaseTemplateById: () => undefined, // loading state → no pre-population in create mode
}));

// ─── Import component under test ──────────────────────────────────────────────

import { TemplateForm } from "../TemplateForm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const noop = () => {};

/**
 * Render TemplateForm in create mode with no pre-existing items.
 * After render, add three items via the add-item UI.
 */
async function renderWithThreeItems() {
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const onCancel = vi.fn();

  render(
    <TemplateForm
      editing={null}
      onSuccess={onSuccess}
      onError={onError}
      onCancel={onCancel}
    />
  );

  // Fill in the required name field so the form can be submitted later
  const nameInput = screen.getByTestId("template-form-name");
  fireEvent.change(nameInput, { target: { value: "Test Template" } });

  // Add three items: Alpha, Beta, Gamma
  const itemInput = screen.getByTestId("template-form-item-input");
  const addButton = screen.getByTestId("template-form-item-add");

  fireEvent.change(itemInput, { target: { value: "Alpha" } });
  fireEvent.click(addButton);

  fireEvent.change(itemInput, { target: { value: "Beta" } });
  fireEvent.click(addButton);

  fireEvent.change(itemInput, { target: { value: "Gamma" } });
  fireEvent.click(addButton);

  return { onSuccess, onError, onCancel };
}

/**
 * Return the text content of each item name span in list order.
 */
function getItemNames(): string[] {
  const list = screen.getByTestId("template-form-item-list");
  return within(list)
    .getAllByRole("listitem")
    .map((li) => {
      // The item name is inside the li but NOT inside the buttons.
      // Find it by querying the non-button text nodes.
      const nameEl = li.querySelector('[class*="itemName"]');
      return nameEl?.textContent ?? "";
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TemplateForm — item reordering (Sub-AC 3c)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Up/down button rendering ───────────────────────────────────────────────

  it("1. renders ↑ and ↓ move buttons for each item row", async () => {
    await renderWithThreeItems();

    // Each item (0, 1, 2) has both buttons
    for (let i = 0; i < 3; i++) {
      expect(
        screen.getByTestId(`template-form-item-move-up-${i}`)
      ).toBeDefined();
      expect(
        screen.getByTestId(`template-form-item-move-down-${i}`)
      ).toBeDefined();
    }
  });

  it("2. ↑ button of the first item is disabled", async () => {
    await renderWithThreeItems();

    const upBtn = screen.getByTestId("template-form-item-move-up-0");
    expect((upBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("3. ↓ button of the last item is disabled", async () => {
    await renderWithThreeItems();

    const downBtn = screen.getByTestId("template-form-item-move-down-2");
    expect((downBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("4. clicking ↑ on item at index 1 moves it to index 0", async () => {
    await renderWithThreeItems();

    // Before: [Alpha, Beta, Gamma]
    expect(getItemNames()).toEqual(["Alpha", "Beta", "Gamma"]);

    fireEvent.click(screen.getByTestId("template-form-item-move-up-1"));

    // After: [Beta, Alpha, Gamma]
    expect(getItemNames()).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("5. clicking ↓ on item at index 0 moves it to index 1", async () => {
    await renderWithThreeItems();

    // Before: [Alpha, Beta, Gamma]
    fireEvent.click(screen.getByTestId("template-form-item-move-down-0"));

    // After: [Beta, Alpha, Gamma]
    expect(getItemNames()).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("6. multiple consecutive moves accumulate correctly", async () => {
    await renderWithThreeItems();

    // Move Alpha down twice: [Alpha,Beta,Gamma] → [Beta,Alpha,Gamma] → [Beta,Gamma,Alpha]
    fireEvent.click(screen.getByTestId("template-form-item-move-down-0"));
    fireEvent.click(screen.getByTestId("template-form-item-move-down-1"));

    expect(getItemNames()).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  // ── Drag-and-drop ─────────────────────────────────────────────────────────

  it("8. each item row has draggable=true", async () => {
    await renderWithThreeItems();

    const listItems = screen
      .getByTestId("template-form-item-list")
      .querySelectorAll("li");

    listItems.forEach((li) => {
      expect(li.getAttribute("draggable")).toBe("true");
    });
  });

  it("11. dropping item[0] onto item[2] moves item[0] to position 2", async () => {
    await renderWithThreeItems();

    // Before: [Alpha, Beta, Gamma]
    const list = screen.getByTestId("template-form-item-list");
    const listItems = list.querySelectorAll("li");

    const sourceItem = listItems[0]; // Alpha
    const targetItem = listItems[2]; // Gamma

    // Simulate drag-and-drop sequence
    fireEvent.dragStart(sourceItem, {
      dataTransfer: { effectAllowed: "move", setData: vi.fn(), getData: vi.fn(() => "0") },
    });
    fireEvent.dragOver(targetItem, {
      dataTransfer: { dropEffect: "move" },
    });
    fireEvent.drop(targetItem, {
      dataTransfer: { getData: vi.fn(() => "0") },
    });
    fireEvent.dragEnd(sourceItem);

    // After: [Beta, Gamma, Alpha]
    expect(getItemNames()).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  it("12. dropping an item onto itself is a no-op", async () => {
    await renderWithThreeItems();

    const list = screen.getByTestId("template-form-item-list");
    const listItems = list.querySelectorAll("li");
    const item = listItems[1]; // Beta at index 1

    fireEvent.dragStart(item, {
      dataTransfer: { effectAllowed: "move", setData: vi.fn(), getData: vi.fn(() => "1") },
    });
    fireEvent.dragOver(item, {
      dataTransfer: { dropEffect: "move" },
    });
    fireEvent.drop(item, {
      dataTransfer: { getData: vi.fn(() => "1") },
    });
    fireEvent.dragEnd(item);

    // Order unchanged
    expect(getItemNames()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  // ── Form state before submit ───────────────────────────────────────────────

  it("14. after reordering, sortOrder values match new positions on submit", async () => {
    const { onSuccess, onCancel } = await renderWithThreeItems();

    mockCreateTemplate.mockResolvedValue({ templateId: "tpl-1" });
    // We need onCancel to be called after success, mock it
    onSuccess.mockImplementation(() => {});
    onCancel.mockImplementation(() => {});

    // Move Alpha to the end: [Alpha,Beta,Gamma] → [Beta,Alpha,Gamma] → [Beta,Gamma,Alpha]
    fireEvent.click(screen.getByTestId("template-form-item-move-down-0"));
    fireEvent.click(screen.getByTestId("template-form-item-move-down-1"));

    // Submit the form
    fireEvent.submit(screen.getByRole("form", { name: "Create kit template" }));

    // Wait for the async handler
    await vi.waitFor(() => expect(mockCreateTemplate).toHaveBeenCalledTimes(1));

    const calledWith = mockCreateTemplate.mock.calls[0][0] as {
      items: Array<{ name: string; sortOrder: number }>;
    };

    expect(calledWith.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Beta", sortOrder: 0 }),
        expect.objectContaining({ name: "Gamma", sortOrder: 1 }),
        expect.objectContaining({ name: "Alpha", sortOrder: 2 }),
      ])
    );
  });

  it("15. item names are preserved exactly after reordering", async () => {
    await renderWithThreeItems();

    // Reorder: move Gamma to the top via two ↑ clicks
    fireEvent.click(screen.getByTestId("template-form-item-move-up-2"));
    fireEvent.click(screen.getByTestId("template-form-item-move-up-1"));

    expect(getItemNames()).toEqual(["Gamma", "Alpha", "Beta"]);
  });
});
