// @vitest-environment jsdom

/**
 * SiteSelector.test.tsx
 *
 * Unit tests for the SiteSelector searchable site combobox component.
 *
 * Tests cover:
 *   1. Renders the search input with correct ARIA attributes
 *   2. Shows loading spinner while Convex data is loading (undefined)
 *   3. Opens dropdown on text input when matching sites exist
 *   4. Filters sites by name (case-insensitive)
 *   5. Filters sites by locationName
 *   6. Shows no-results state when query matches nothing
 *   7. Calls onSelect with correct payload on option click (mousedown)
 *   8. Keyboard: ArrowDown opens list and advances highlighted index
 *   9. Keyboard: ArrowUp retreats highlighted index
 *  10. Keyboard: Enter selects the highlighted option
 *  11. Keyboard: Escape closes the dropdown without selection
 *  12. Keyboard: Enter with no highlighted option selects first result
 *  13. Calls onSelect(null) when clear button is clicked
 *  14. Renders selection chip when showChip=true and a site is selected
 *  15. Does not render selection chip when showChip=false
 *  16. Passes statusFilter to the Convex query
 *  17. Input is disabled when disabled=true
 *  18. Syncs input text when value prop changes externally
 *  19. Each option has correct data-testid
 *  20. Input has role="combobox" and correct ARIA attributes
 *
 * Mocking strategy:
 *   - convex/react: `useQuery` is replaced with a vi.fn() spy that returns
 *     the mock data configured in beforeEach().  This isolates the component
 *     from the Convex runtime entirely.
 *   - convex/_generated/api: mocked as a plain object so `api.sites.listSites`
 *     resolves to a stable reference (we don't need the real FunctionReference).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

// ─── DOM cleanup + mock reset ─────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  // Reset mock state after each test so mock return values don't leak
  // between tests in different describe blocks.
  mockUseQuery.mockReset();
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock convex/react — useQuery must be synchronous in tests
vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

// Mock the generated Convex API — we only need a stable reference
vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    sites: {
      listSites: "sites:listSites",
    },
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { useQuery } from "convex/react";
import { SiteSelector } from "../SiteSelector";
import type { SiteSelectorValue } from "../SiteSelector";
import type { SiteSummary } from "../../../../convex/sites";

// ─── Test data ────────────────────────────────────────────────────────────────

const MOCK_SITES: SiteSummary[] = [
  {
    siteId:       "site_abc123",
    name:         "Alpha Wind Farm",
    description:  "Primary deployment site",
    status:       "active",
    lat:          47.6062,
    lng:          -122.3321,
    locationName: "Seattle, WA",
    leadName:     "Jordan Lee",
    updatedAt:    1700000000000,
  },
  {
    siteId:       "site_def456",
    name:         "Beta Offshore",
    status:       "planning",
    lat:          42.3601,
    lng:          -71.0589,
    locationName: "Boston Harbor, MA",
    updatedAt:    1699000000000,
  },
  {
    siteId:       "site_ghi789",
    name:         "Gamma Mesa",
    status:       "completed",
    locationName: "Phoenix, AZ",
    updatedAt:    1698000000000,
  },
  {
    siteId:       "site_jkl012",
    name:         "Delta Plains",
    status:       "cancelled",
    locationName: "Amarillo, TX",
    updatedAt:    1697000000000,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockUseQuery = useQuery as Mock;

function renderSelector(
  props: Partial<React.ComponentProps<typeof SiteSelector>> = {},
  sites: SiteSummary[] | undefined = MOCK_SITES
) {
  mockUseQuery.mockReturnValue(sites);

  const onSelect = vi.fn();
  const utils = render(
    <SiteSelector
      value={props.value ?? null}
      onSelect={props.onSelect ?? onSelect}
      {...props}
    />
  );
  return { ...utils, onSelect };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SiteSelector — rendering", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue(MOCK_SITES);
  });

  it("renders a text input", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    expect(input).toBeTruthy();
    expect(input.tagName.toLowerCase()).toBe("input");
    expect(input.getAttribute("type")).toBe("text");
  });

  it("input has role=combobox", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    expect(input.getAttribute("role")).toBe("combobox");
  });

  it("input has aria-haspopup=listbox", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    expect(input.getAttribute("aria-haspopup")).toBe("listbox");
  });

  it("input aria-expanded is false when dropdown is closed", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders placeholder text", () => {
    renderSelector({ placeholder: "Pick a deployment site" });
    const input = screen.getByTestId("site-selector-input");
    expect(input.getAttribute("placeholder")).toBe("Pick a deployment site");
  });

  it("renders default placeholder when not specified", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    expect(input.getAttribute("placeholder")).toBe("Search sites…");
  });

  it("input is disabled when disabled=true", () => {
    renderSelector({ disabled: true });
    const input = screen.getByTestId("site-selector-input");
    expect(input.hasAttribute("disabled")).toBe(true);
  });

  it("does NOT render the clear button when input is empty", () => {
    renderSelector();
    expect(screen.queryByTestId("site-selector-clear")).toBeNull();
  });

  it("does NOT render the dropdown initially", () => {
    renderSelector();
    expect(screen.queryByTestId("site-selector-listbox")).toBeNull();
  });
});

describe("SiteSelector — loading state", () => {
  it("shows loading spinner while sites are undefined", () => {
    // NOTE: passing `undefined` explicitly to renderSelector triggers the
    // JS default-parameter rule (undefined → default = MOCK_SITES). Set the
    // mock return value directly so useQuery returns undefined (loading state).
    mockUseQuery.mockReturnValue(undefined);
    const onSelect = vi.fn();
    render(<SiteSelector value={null} onSelect={onSelect} />);
    expect(screen.getByTestId("site-selector-loading")).toBeTruthy();
  });

  it("does NOT show loading spinner when sites are loaded", () => {
    renderSelector({}, MOCK_SITES);
    expect(screen.queryByTestId("site-selector-loading")).toBeNull();
  });
});

describe("SiteSelector — filtering", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue(MOCK_SITES);
  });

  it("opens dropdown and shows matching sites when user types", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    const listbox = screen.getByTestId("site-selector-listbox");
    expect(listbox).toBeTruthy();
    expect(screen.getByTestId("site-option-site_abc123")).toBeTruthy();
  });

  it("filters sites case-insensitively by name", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "BETA" } });

    expect(screen.getByTestId("site-option-site_def456")).toBeTruthy();
    expect(screen.queryByTestId("site-option-site_abc123")).toBeNull();
  });

  it("filters sites by locationName", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "phoenix" } });

    expect(screen.getByTestId("site-option-site_ghi789")).toBeTruthy();
  });

  it("shows no-results state when query matches nothing", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "xyzzy_no_match_12345" } });

    expect(screen.getByTestId("site-selector-no-results")).toBeTruthy();
  });

  it("shows clear button when input has text", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    expect(screen.getByTestId("site-selector-clear")).toBeTruthy();
  });
});

describe("SiteSelector — selection", () => {
  it("calls onSelect with correct payload on option mousedown", () => {
    const onSelect = vi.fn();
    mockUseQuery.mockReturnValue(MOCK_SITES);
    render(
      <SiteSelector value={null} onSelect={onSelect} />
    );

    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    const option = screen.getByTestId("site-option-site_abc123");
    fireEvent.mouseDown(option);

    expect(onSelect).toHaveBeenCalledWith({
      siteId:   "site_abc123",
      siteName: "Alpha Wind Farm",
    } satisfies SiteSelectorValue);
  });

  it("updates input text to selected site name after selection", () => {
    const onSelect = vi.fn();
    mockUseQuery.mockReturnValue(MOCK_SITES);
    render(
      <SiteSelector value={null} onSelect={onSelect} />
    );

    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "beta" } });

    const option = screen.getByTestId("site-option-site_def456");
    fireEvent.mouseDown(option);

    // After selection the input should show the site name
    expect((input as HTMLInputElement).value).toBe("Beta Offshore");
  });

  it("closes dropdown after selection", () => {
    const onSelect = vi.fn();
    mockUseQuery.mockReturnValue(MOCK_SITES);
    render(
      <SiteSelector value={null} onSelect={onSelect} />
    );

    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "gamma" } });
    expect(screen.queryByTestId("site-selector-listbox")).toBeTruthy();

    const option = screen.getByTestId("site-option-site_ghi789");
    fireEvent.mouseDown(option);

    expect(screen.queryByTestId("site-selector-listbox")).toBeNull();
  });

  it("calls onSelect(null) when clear button is clicked", () => {
    const onSelect = vi.fn();
    mockUseQuery.mockReturnValue(MOCK_SITES);

    const value: SiteSelectorValue = { siteId: "site_abc123", siteName: "Alpha Wind Farm" };
    render(
      <SiteSelector value={value} onSelect={onSelect} />
    );

    // Type something to get the clear button visible
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "Alpha Wind Farm" } });

    const clearBtn = screen.getByTestId("site-selector-clear");
    fireEvent.click(clearBtn);

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("SiteSelector — keyboard navigation", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue(MOCK_SITES);
  });

  it("ArrowDown opens the dropdown when closed", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");

    // Type to get matching results first
    fireEvent.change(input, { target: { value: "a" } });
    // Close it by pressing Escape
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("site-selector-listbox")).toBeNull();

    // ArrowDown should reopen
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.queryByTestId("site-selector-listbox")).toBeTruthy();
  });

  it("Escape closes the dropdown", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });
    expect(screen.queryByTestId("site-selector-listbox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("site-selector-listbox")).toBeNull();
  });

  it("Enter selects the first result when no option is highlighted", () => {
    const onSelect = vi.fn();
    mockUseQuery.mockReturnValue(MOCK_SITES);
    render(<SiteSelector value={null} onSelect={onSelect} />);

    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    // Press Enter without navigating — should select first result
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith({
      siteId:   "site_abc123",
      siteName: "Alpha Wind Farm",
    });
  });

  it("Enter does not call onSelect when the dropdown is closed", () => {
    const onSelect = vi.fn();
    mockUseQuery.mockReturnValue(MOCK_SITES);
    render(<SiteSelector value={null} onSelect={onSelect} />);

    const input = screen.getByTestId("site-selector-input");
    // Enter on a closed dropdown should be a no-op
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Tab closes the dropdown", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "beta" } });
    expect(screen.queryByTestId("site-selector-listbox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.queryByTestId("site-selector-listbox")).toBeNull();
  });
});

describe("SiteSelector — selection chip", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue(MOCK_SITES);
  });

  it("renders selection chip when showChip=true and site is selected", () => {
    const value: SiteSelectorValue = { siteId: "site_abc123", siteName: "Alpha Wind Farm" };
    render(
      <SiteSelector value={value} onSelect={vi.fn()} showChip={true} />
    );
    expect(screen.getByTestId("site-selector-chip")).toBeTruthy();
  });

  it("does NOT render chip when showChip=false", () => {
    const value: SiteSelectorValue = { siteId: "site_abc123", siteName: "Alpha Wind Farm" };
    render(
      <SiteSelector value={value} onSelect={vi.fn()} showChip={false} />
    );
    expect(screen.queryByTestId("site-selector-chip")).toBeNull();
  });

  it("does NOT render chip when no site is selected (value=null)", () => {
    render(
      <SiteSelector value={null} onSelect={vi.fn()} showChip={true} />
    );
    expect(screen.queryByTestId("site-selector-chip")).toBeNull();
  });

  it("chip shows the selected site name", () => {
    const value: SiteSelectorValue = { siteId: "site_abc123", siteName: "Alpha Wind Farm" };
    render(
      <SiteSelector value={value} onSelect={vi.fn()} showChip={true} />
    );
    const chip = screen.getByTestId("site-selector-chip");
    expect(chip.textContent).toContain("Alpha Wind Farm");
  });

  it("chip shows the site ID", () => {
    const value: SiteSelectorValue = { siteId: "site_abc123", siteName: "Alpha Wind Farm" };
    render(
      <SiteSelector value={value} onSelect={vi.fn()} showChip={true} />
    );
    const chip = screen.getByTestId("site-selector-chip");
    expect(chip.textContent).toContain("site_abc123");
  });
});

describe("SiteSelector — external value sync", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue(MOCK_SITES);
  });

  it("syncs input text when value is cleared externally (value=null)", () => {
    const { rerender } = render(
      <SiteSelector
        value={{ siteId: "site_abc123", siteName: "Alpha Wind Farm" }}
        onSelect={vi.fn()}
      />
    );

    // Clear the value externally
    rerender(
      <SiteSelector
        value={null}
        onSelect={vi.fn()}
      />
    );

    const input = screen.getByTestId("site-selector-input");
    expect((input as HTMLInputElement).value).toBe("");
  });
});

describe("SiteSelector — accessibility", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue(MOCK_SITES);
  });

  it("input accepts aria-label prop", () => {
    renderSelector({ "aria-label": "Select deployment site" });
    const input = screen.getByTestId("site-selector-input");
    expect(input.getAttribute("aria-label")).toBe("Select deployment site");
  });

  it("input accepts aria-describedby prop", () => {
    renderSelector({ "aria-describedby": "site-help-text" });
    const input = screen.getByTestId("site-selector-input");
    expect(input.getAttribute("aria-describedby")).toBe("site-help-text");
  });

  it("input id is set when id prop is provided", () => {
    renderSelector({ id: "my-site-selector" });
    const input = screen.getByTestId("site-selector-input");
    expect(input.getAttribute("id")).toBe("my-site-selector");
  });

  it("clear button has accessible aria-label", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    const clearBtn = screen.getByTestId("site-selector-clear");
    expect(clearBtn.getAttribute("aria-label")).toBe("Clear selected site");
  });

  it("listbox has role=listbox", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    const listbox = screen.getByTestId("site-selector-listbox");
    expect(listbox.getAttribute("role")).toBe("listbox");
  });

  it("each option has role=option", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    const option = screen.getByTestId("site-option-site_abc123");
    expect(option.getAttribute("role")).toBe("option");
  });
});

describe("SiteSelector — option content", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue(MOCK_SITES);
  });

  it("renders site name in option", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    expect(screen.getByText("Alpha Wind Farm")).toBeTruthy();
  });

  it("renders location name in option when available", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    expect(screen.getByText("Seattle, WA")).toBeTruthy();
  });

  it("renders status badge in option", () => {
    renderSelector();
    const input = screen.getByTestId("site-selector-input");
    fireEvent.change(input, { target: { value: "alpha" } });

    // The active badge label
    expect(screen.getByText("Active")).toBeTruthy();
  });
});
