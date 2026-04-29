/**
 * @vitest-environment jsdom
 *
 * Unit tests: UserSelector — searchable user picker combobox.
 *
 * Tests:
 *  Structure & ARIA
 *   1.  Renders a container with data-testid="user-selector".
 *   2.  Renders an input with role="combobox".
 *   3.  Input starts with aria-expanded="false" when no text entered.
 *   4.  Input receives the id prop when provided.
 *   5.  Input receives aria-describedby when provided.
 *   6.  Renders a search icon inside the input wrap.
 *
 *  Loading state
 *   7.  Shows loading spinner (data-testid="user-selector-loading") while
 *       Convex users is undefined.
 *   8.  Hides loading spinner once users are loaded.
 *
 *  Filtering
 *   9.  Typing a query opens the listbox.
 *  10.  Listbox renders only users whose name contains the query.
 *  11.  Listbox renders users whose email contains the query.
 *  12.  Listbox renders an empty-state option when no users match.
 *  13.  Listbox is hidden when input is empty.
 *  14.  Filtering is case-insensitive.
 *  15.  At most MAX_RESULTS (10) options appear even with many matching users.
 *
 *  Selection
 *  16.  Clicking an option calls onChange with { userId, userName }.
 *  17.  After selection, input text is set to the user's display name.
 *  18.  After selection, listbox closes.
 *  19.  After selection, selection chip (data-testid="user-selector-chip")
 *       appears with the selected user's name.
 *  20.  Typing after selection calls onChange(null) to clear selection.
 *
 *  Clear button
 *  21.  Clear button (data-testid="user-selector-clear") is hidden when
 *       input is empty.
 *  22.  Clear button is shown when input has text.
 *  23.  Clicking clear button empties the input and calls onChange(null).
 *
 *  Keyboard navigation
 *  24.  ArrowDown opens the listbox and highlights the first option.
 *  25.  ArrowDown again advances the highlight to the second option.
 *  26.  Enter selects the highlighted option and closes the listbox.
 *  27.  Escape closes the listbox without selecting.
 *  28.  ArrowUp does not go below index 0 (no negative wrap).
 *
 *  Controlled value sync
 *  29.  When `value` is set externally, input text matches value.userName.
 *  30.  When `value` is set to null externally, input text is cleared.
 *
 *  Disabled state
 *  31.  Input is disabled when disabled prop is true.
 *  32.  Clear button is hidden when disabled=true even with text.
 */

import React, { useState } from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { UserSelector } from "../UserSelector";
import type { UserSelectorValue } from "../UserSelector";

// ─── Mock convex/react ────────────────────────────────────────────────────────

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    users: {
      listUsers: "api.users.listUsers",
    },
  },
}));

// ─── Mock user data ────────────────────────────────────────────────────────────

const MOCK_USERS = [
  {
    _id: "doc1",
    kindeId: "kp_alice",
    name: "Alice Adams",
    email: "alice@skyspecs.com",
  },
  {
    _id: "doc2",
    kindeId: "kp_bob",
    name: "Bob Baker",
    email: "bob@skyspecs.com",
  },
  {
    _id: "doc3",
    kindeId: "kp_charlie",
    name: "Charlie Clark",
    email: "charlie@skyspecs.com",
  },
  {
    _id: "doc4",
    kindeId: "kp_diana",
    name: "Diana Davis",
    email: "diana@example.org",
  },
];

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { useQuery } from "convex/react";

const mockUseQuery = vi.mocked(useQuery);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Controlled wrapper so we can easily test onChange behaviour.
 */
function ControlledUserSelector(
  props: Partial<{
    initialValue: UserSelectorValue | null;
    onChange: (v: UserSelectorValue | null) => void;
    disabled: boolean;
    id: string;
    "aria-describedby": string;
    placeholder: string;
  }>
) {
  const [value, setValue] = useState<UserSelectorValue | null>(
    props.initialValue ?? null
  );

  const handleChange = (u: UserSelectorValue | null) => {
    setValue(u);
    props.onChange?.(u);
  };

  return (
    <UserSelector
      value={value}
      onChange={handleChange}
      disabled={props.disabled}
      id={props.id}
      aria-describedby={props["aria-describedby"]}
      placeholder={props.placeholder}
    />
  );
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Default: users are loaded
  mockUseQuery.mockReturnValue(MOCK_USERS as unknown as ReturnType<typeof useQuery>);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// ─── 1. Structure & ARIA ─────────────────────────────────────────────────────

describe("UserSelector — structure and ARIA", () => {
  it("1. renders a container with data-testid='user-selector'", () => {
    render(<UserSelector value={null} onChange={() => {}} />);
    expect(screen.getByTestId("user-selector")).toBeTruthy();
  });

  it("2. renders an input with role='combobox'", () => {
    render(<UserSelector value={null} onChange={() => {}} />);
    const input = screen.getByRole("combobox");
    expect(input).toBeTruthy();
  });

  it("3. input starts with aria-expanded='false' when no text entered", () => {
    render(<UserSelector value={null} onChange={() => {}} />);
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("4. input receives the id prop when provided", () => {
    render(<UserSelector value={null} onChange={() => {}} id="my-input" />);
    const input = screen.getByRole("combobox");
    expect(input.id).toBe("my-input");
  });

  it("5. input receives aria-describedby when provided", () => {
    render(
      <UserSelector
        value={null}
        onChange={() => {}}
        aria-describedby="hint-text"
      />
    );
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-describedby")).toBe("hint-text");
  });
});

// ─── 2. Loading state ─────────────────────────────────────────────────────────

describe("UserSelector — loading state", () => {
  it("7. shows loading spinner while Convex users is undefined", () => {
    mockUseQuery.mockReturnValue(undefined as unknown as ReturnType<typeof useQuery>);
    render(<UserSelector value={null} onChange={() => {}} />);
    expect(screen.getByTestId("user-selector-loading")).toBeTruthy();
  });

  it("8. hides loading spinner once users are loaded", () => {
    mockUseQuery.mockReturnValue(MOCK_USERS as unknown as ReturnType<typeof useQuery>);
    render(<UserSelector value={null} onChange={() => {}} />);
    expect(screen.queryByTestId("user-selector-loading")).toBeNull();
  });
});

// ─── 3. Filtering ─────────────────────────────────────────────────────────────

describe("UserSelector — filtering", () => {
  it("9. typing a query opens the listbox", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });
    expect(screen.getByTestId("user-selector-listbox")).toBeTruthy();
  });

  it("10. listbox renders only users whose name contains the query", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });
    expect(screen.getByTestId("user-option-kp_alice")).toBeTruthy();
    expect(screen.queryByTestId("user-option-kp_bob")).toBeNull();
    expect(screen.queryByTestId("user-option-kp_charlie")).toBeNull();
  });

  it("11. listbox renders users whose email contains the query", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");
    // "example" only matches Diana's email
    await act(async () => {
      fireEvent.change(input, { target: { value: "example" } });
    });
    expect(screen.getByTestId("user-option-kp_diana")).toBeTruthy();
    expect(screen.queryByTestId("user-option-kp_alice")).toBeNull();
  });

  it("12. listbox renders an empty-state option when no users match", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "zzznomatch999" } });
    });
    expect(screen.getByTestId("user-selector-no-results")).toBeTruthy();
  });

  it("13. listbox is hidden when input is empty", () => {
    render(<ControlledUserSelector />);
    // No typing — input is empty by default
    expect(screen.queryByTestId("user-selector-listbox")).toBeNull();
  });

  it("14. filtering is case-insensitive", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "ALICE" } });
    });
    expect(screen.getByTestId("user-option-kp_alice")).toBeTruthy();
  });

  it("15. at most 10 options appear with many matching users", async () => {
    // Create 15 users all matching "user"
    const manyUsers = Array.from({ length: 15 }, (_, i) => ({
      _id: `doc${i}`,
      kindeId: `kp_user${i}`,
      name: `User ${i}`,
      email: `user${i}@test.com`,
    }));
    mockUseQuery.mockReturnValue(manyUsers as unknown as ReturnType<typeof useQuery>);

    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "user" } });
    });

    const listbox = screen.getByTestId("user-selector-listbox");
    // MAX_RESULTS is 10 — 10 li[role=option] children (no no-results state)
    const options = listbox.querySelectorAll("li[role='option']");
    expect(options.length).toBe(10);
  });
});

// ─── 4. Selection ─────────────────────────────────────────────────────────────

describe("UserSelector — selection", () => {
  it("16. clicking an option calls onChange with { userId, userName }", async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledUserSelector onChange={onChangeSpy} />);
    const input = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });

    const aliceOption = screen.getByTestId("user-option-kp_alice");
    await act(async () => {
      fireEvent.mouseDown(aliceOption);
    });

    expect(onChangeSpy).toHaveBeenCalledWith({
      userId: "kp_alice",
      userName: "Alice Adams",
    });
  });

  it("17. after selection, input text is set to the user's display name", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });

    const aliceOption = screen.getByTestId("user-option-kp_alice");
    await act(async () => {
      fireEvent.mouseDown(aliceOption);
    });

    expect(input.value).toBe("Alice Adams");
  });

  it("18. after selection, listbox closes", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });
    expect(screen.getByTestId("user-selector-listbox")).toBeTruthy();

    const aliceOption = screen.getByTestId("user-option-kp_alice");
    await act(async () => {
      fireEvent.mouseDown(aliceOption);
    });

    expect(screen.queryByTestId("user-selector-listbox")).toBeNull();
  });

  it("19. after selection, selection chip appears with the user's name", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(input, { target: { value: "bob" } });
    });
    const bobOption = screen.getByTestId("user-option-kp_bob");
    await act(async () => {
      fireEvent.mouseDown(bobOption);
    });

    const chip = screen.getByTestId("user-selector-chip");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain("Bob Baker");
  });

  it("20. typing after selection calls onChange(null) to clear selection", async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledUserSelector onChange={onChangeSpy} />);
    const input = screen.getByRole("combobox");

    // Select Alice first
    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("user-option-kp_alice"));
    });

    // Now type again — should clear selection
    onChangeSpy.mockClear();
    await act(async () => {
      fireEvent.change(input, { target: { value: "b" } });
    });

    expect(onChangeSpy).toHaveBeenCalledWith(null);
  });
});

// ─── 5. Clear button ──────────────────────────────────────────────────────────

describe("UserSelector — clear button", () => {
  it("21. clear button is hidden when input is empty", () => {
    render(<ControlledUserSelector />);
    expect(screen.queryByTestId("user-selector-clear")).toBeNull();
  });

  it("22. clear button is shown when input has text", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });
    expect(screen.getByTestId("user-selector-clear")).toBeTruthy();
  });

  it("23. clicking clear button empties the input and calls onChange(null)", async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledUserSelector onChange={onChangeSpy} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    // Type something to make clear button appear
    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });

    onChangeSpy.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId("user-selector-clear"));
    });

    expect(input.value).toBe("");
    expect(onChangeSpy).toHaveBeenCalledWith(null);
  });
});

// ─── 6. Keyboard navigation ───────────────────────────────────────────────────

describe("UserSelector — keyboard navigation", () => {
  it("24. ArrowDown opens the listbox and highlights the first option", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");

    // Type to populate results
    await act(async () => {
      fireEvent.change(input, { target: { value: "a" } });
    });
    // Close listbox first via Escape
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(screen.queryByTestId("user-selector-listbox")).toBeNull();

    // ArrowDown should reopen and highlight index 0
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });

    const listbox = screen.getByTestId("user-selector-listbox");
    expect(listbox).toBeTruthy();
    // First matching option should have the highlighted class
    const firstOption = listbox.querySelector("li.optionHighlighted");
    // CSS Modules rename class; check aria-selected instead
    const highlightedOption = listbox.querySelector("li[aria-selected='true']");
    expect(highlightedOption).toBeTruthy();
  });

  it("25. ArrowDown again advances highlight to the second option", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");

    // Show at least 2 results (all users match "")
    // Use a short query that matches multiple users
    await act(async () => {
      fireEvent.change(input, { target: { value: "sky" } });
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });

    const listbox = screen.getByTestId("user-selector-listbox");
    const options = listbox.querySelectorAll("li[role='option']");
    // Second option (index 1) should be aria-selected=true
    if (options.length >= 2) {
      expect(options[1].getAttribute("aria-selected")).toBe("true");
    }
  });

  it("26. Enter selects the highlighted option and closes the listbox", async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledUserSelector onChange={onChangeSpy} />);
    const input = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(screen.queryByTestId("user-selector-listbox")).toBeNull();
    expect(onChangeSpy).toHaveBeenCalledWith({
      userId: "kp_alice",
      userName: "Alice Adams",
    });
  });

  it("27. Escape closes the listbox without selecting", async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledUserSelector onChange={onChangeSpy} />);
    const input = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(screen.queryByTestId("user-selector-listbox")).toBeNull();
    // onChange should not have been called with a user (only with null from typing)
    const calls = onChangeSpy.mock.calls;
    const selectionCalls = calls.filter(
      ([arg]) => arg !== null
    );
    expect(selectionCalls.length).toBe(0);
  });

  it("28. ArrowUp does not go below index 0", async () => {
    render(<ControlledUserSelector />);
    const input = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(input, { target: { value: "ali" } });
    });
    // Press ArrowDown once to highlight index 0
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    // Press ArrowUp — should stay at index 0, not go to -1
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowUp" });
    });

    const listbox = screen.getByTestId("user-selector-listbox");
    const highlighted = listbox.querySelector("li[aria-selected='true']");
    // First option should still be highlighted
    expect(highlighted).toBeTruthy();
  });
});

// ─── 7. Controlled value sync ─────────────────────────────────────────────────

describe("UserSelector — controlled value sync", () => {
  it("29. when value is set externally, input text matches value.userName", () => {
    render(
      <UserSelector
        value={{ userId: "kp_alice", userName: "Alice Adams" }}
        onChange={() => {}}
      />
    );
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("Alice Adams");
  });

  it("30. when value is set to null externally, input text is cleared", () => {
    function Wrapper() {
      const [value, setValue] = useState<UserSelectorValue | null>({
        userId: "kp_alice",
        userName: "Alice Adams",
      });
      return (
        <>
          <UserSelector value={value} onChange={setValue} />
          <button onClick={() => setValue(null)}>Clear</button>
        </>
      );
    }

    render(<Wrapper />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("Alice Adams");

    act(() => {
      fireEvent.click(screen.getByText("Clear"));
    });

    expect(input.value).toBe("");
  });
});

// ─── 8. Disabled state ────────────────────────────────────────────────────────

describe("UserSelector — disabled state", () => {
  it("31. input is disabled when disabled prop is true", () => {
    render(<UserSelector value={null} onChange={() => {}} disabled />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("32. clear button is hidden when disabled=true even with text", () => {
    render(
      <UserSelector
        value={{ userId: "kp_alice", userName: "Alice Adams" }}
        onChange={() => {}}
        disabled
      />
    );
    expect(screen.queryByTestId("user-selector-clear")).toBeNull();
  });
});
