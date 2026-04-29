/**
 * T3SwimLane component unit tests.
 *
 * Covers:
 *   - Column rendering: all four columns (Hangar, Carrier, Field, Returning) present
 *   - Column headers with correct title text and testIds
 *   - Status routing: each case status maps to the correct column
 *   - Case count badges: correct count per column
 *   - Card rendering: label, status, subLabel, location, assignee, damage flag
 *   - Empty-state placeholder: shown per column when no cases
 *   - Loading state: skeleton cards shown instead of real cases
 *   - Selection: selected card has aria-selected="true"
 *   - Click interaction: onSelectCase called with correct case ID
 *   - Non-interactive mode: cards rendered as list items when no onSelectCase
 *   - Accessibility: role="region" on columns, aria-labels present
 *   - Case partition: all StatusKind values covered by at least one column
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { T3SwimLane } from "../T3SwimLane";
import type { SwimLaneCase } from "../T3SwimLane";

afterEach(() => cleanup());

// ─── Test fixtures ────────────────────────────────────────────────────────────

const HANGAR_CASE: SwimLaneCase = {
  id: "case-001",
  label: "CS-001",
  status: "hangar",
};

const ASSEMBLED_CASE: SwimLaneCase = {
  id: "case-002",
  label: "CS-002",
  status: "assembled",
  subLabel: "Kit Alpha",
  location: "Bay 3",
};

const TRANSIT_OUT_CASE: SwimLaneCase = {
  id: "case-003",
  label: "CS-003",
  status: "transit_out",
  assignee: "FedEx Ground",
};

const DEPLOYED_CASE: SwimLaneCase = {
  id: "case-004",
  label: "CS-004",
  status: "deployed",
  location: "Wind Farm North",
};

const FLAGGED_CASE: SwimLaneCase = {
  id: "case-005",
  label: "CS-005",
  status: "flagged",
  hasDamage: true,
};

const TRANSIT_IN_CASE: SwimLaneCase = {
  id: "case-006",
  label: "CS-006",
  status: "transit_in",
};

const RECEIVED_CASE: SwimLaneCase = {
  id: "case-007",
  label: "CS-007",
  status: "received",
  location: "Home Base",
};

const ALL_CASES: SwimLaneCase[] = [
  HANGAR_CASE,
  ASSEMBLED_CASE,
  TRANSIT_OUT_CASE,
  DEPLOYED_CASE,
  FLAGGED_CASE,
  TRANSIT_IN_CASE,
  RECEIVED_CASE,
];

// ─── Column rendering ─────────────────────────────────────────────────────────

describe("T3SwimLane — column rendering", () => {
  it("renders all four columns", () => {
    render(<T3SwimLane cases={[]} />);
    expect(screen.getByTestId("swim-lane-column-hangar")).toBeTruthy();
    expect(screen.getByTestId("swim-lane-column-carrier")).toBeTruthy();
    expect(screen.getByTestId("swim-lane-column-field")).toBeTruthy();
    expect(screen.getByTestId("swim-lane-column-returning")).toBeTruthy();
  });

  it("renders column headers with correct labels", () => {
    render(<T3SwimLane cases={[]} />);
    expect(screen.getByTestId("swim-lane-col-header-hangar")).toBeTruthy();
    expect(screen.getByTestId("swim-lane-col-header-carrier")).toBeTruthy();
    expect(screen.getByTestId("swim-lane-col-header-field")).toBeTruthy();
    expect(screen.getByTestId("swim-lane-col-header-returning")).toBeTruthy();
  });

  it("renders the text 'Hangar' in the hangar column header", () => {
    render(<T3SwimLane cases={[]} />);
    const header = screen.getByTestId("swim-lane-col-header-hangar");
    expect(header.textContent).toContain("Hangar");
  });

  it("renders the text 'Carrier' in the carrier column header", () => {
    render(<T3SwimLane cases={[]} />);
    const header = screen.getByTestId("swim-lane-col-header-carrier");
    expect(header.textContent).toContain("Carrier");
  });

  it("renders the text 'Field' in the field column header", () => {
    render(<T3SwimLane cases={[]} />);
    const header = screen.getByTestId("swim-lane-col-header-field");
    expect(header.textContent).toContain("Field");
  });

  it("renders the text 'Returning' in the returning column header", () => {
    render(<T3SwimLane cases={[]} />);
    const header = screen.getByTestId("swim-lane-col-header-returning");
    expect(header.textContent).toContain("Returning");
  });

  it("renders the outer grid with data-testid t3-swim-lane", () => {
    render(<T3SwimLane cases={[]} />);
    expect(screen.getByTestId("t3-swim-lane")).toBeTruthy();
  });

  it("applies extra className to the wrapper", () => {
    const { container } = render(
      <T3SwimLane cases={[]} className="my-extra-class" />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("my-extra-class");
  });
});

// ─── Status routing / column partitioning ─────────────────────────────────────

describe("T3SwimLane — status routing", () => {
  it("routes hangar status case to Hangar column", () => {
    render(<T3SwimLane cases={[HANGAR_CASE]} />);
    expect(
      screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`)
        .closest("[data-testid='swim-lane-column-hangar']")
    ).toBeTruthy();
  });

  it("routes assembled status case to Hangar column", () => {
    render(<T3SwimLane cases={[ASSEMBLED_CASE]} />);
    expect(
      screen.getByTestId(`swim-lane-card-${ASSEMBLED_CASE.id}`)
        .closest("[data-testid='swim-lane-column-hangar']")
    ).toBeTruthy();
  });

  it("routes transit_out status case to Carrier column", () => {
    render(<T3SwimLane cases={[TRANSIT_OUT_CASE]} />);
    expect(
      screen.getByTestId(`swim-lane-card-${TRANSIT_OUT_CASE.id}`)
        .closest("[data-testid='swim-lane-column-carrier']")
    ).toBeTruthy();
  });

  it("routes in_transit status case to Carrier column", () => {
    const c: SwimLaneCase = { id: "x1", label: "X-001", status: "in_transit" };
    render(<T3SwimLane cases={[c]} />);
    expect(
      screen.getByTestId("swim-lane-card-x1")
        .closest("[data-testid='swim-lane-column-carrier']")
    ).toBeTruthy();
  });

  it("routes label_created status case to Carrier column", () => {
    const c: SwimLaneCase = { id: "x2", label: "X-002", status: "label_created" };
    render(<T3SwimLane cases={[c]} />);
    expect(
      screen.getByTestId("swim-lane-card-x2")
        .closest("[data-testid='swim-lane-column-carrier']")
    ).toBeTruthy();
  });

  it("routes deployed status case to Field column", () => {
    render(<T3SwimLane cases={[DEPLOYED_CASE]} />);
    expect(
      screen.getByTestId(`swim-lane-card-${DEPLOYED_CASE.id}`)
        .closest("[data-testid='swim-lane-column-field']")
    ).toBeTruthy();
  });

  it("routes flagged status case to Field column", () => {
    render(<T3SwimLane cases={[FLAGGED_CASE]} />);
    expect(
      screen.getByTestId(`swim-lane-card-${FLAGGED_CASE.id}`)
        .closest("[data-testid='swim-lane-column-field']")
    ).toBeTruthy();
  });

  it("routes transit_in status case to Returning column", () => {
    render(<T3SwimLane cases={[TRANSIT_IN_CASE]} />);
    expect(
      screen.getByTestId(`swim-lane-card-${TRANSIT_IN_CASE.id}`)
        .closest("[data-testid='swim-lane-column-returning']")
    ).toBeTruthy();
  });

  it("routes received status case to Returning column", () => {
    render(<T3SwimLane cases={[RECEIVED_CASE]} />);
    expect(
      screen.getByTestId(`swim-lane-card-${RECEIVED_CASE.id}`)
        .closest("[data-testid='swim-lane-column-returning']")
    ).toBeTruthy();
  });

  it("routes archived status case to Returning column", () => {
    const c: SwimLaneCase = { id: "x3", label: "X-003", status: "archived" };
    render(<T3SwimLane cases={[c]} />);
    expect(
      screen.getByTestId("swim-lane-card-x3")
        .closest("[data-testid='swim-lane-column-returning']")
    ).toBeTruthy();
  });

  it("routes delivered status case to Returning column", () => {
    const c: SwimLaneCase = { id: "x4", label: "X-004", status: "delivered" };
    render(<T3SwimLane cases={[c]} />);
    expect(
      screen.getByTestId("swim-lane-card-x4")
        .closest("[data-testid='swim-lane-column-returning']")
    ).toBeTruthy();
  });
});

// ─── Count badges ─────────────────────────────────────────────────────────────

describe("T3SwimLane — count badges", () => {
  it("shows correct count in Hangar badge", () => {
    render(<T3SwimLane cases={ALL_CASES} />);
    // Hangar gets hangar + assembled = 2
    const badge = screen.getByTestId("swim-lane-col-count-hangar");
    expect(badge.textContent?.trim()).toBe("2");
  });

  it("shows correct count in Carrier badge", () => {
    render(<T3SwimLane cases={ALL_CASES} />);
    // Carrier gets transit_out = 1
    const badge = screen.getByTestId("swim-lane-col-count-carrier");
    expect(badge.textContent?.trim()).toBe("1");
  });

  it("shows correct count in Field badge", () => {
    render(<T3SwimLane cases={ALL_CASES} />);
    // Field gets deployed + flagged = 2
    const badge = screen.getByTestId("swim-lane-col-count-field");
    expect(badge.textContent?.trim()).toBe("2");
  });

  it("shows correct count in Returning badge", () => {
    render(<T3SwimLane cases={ALL_CASES} />);
    // Returning gets transit_in + received = 2
    const badge = screen.getByTestId("swim-lane-col-count-returning");
    expect(badge.textContent?.trim()).toBe("2");
  });

  it("shows 0 in badge when column is empty", () => {
    render(<T3SwimLane cases={[HANGAR_CASE]} />);
    // No cases routed to carrier
    const badge = screen.getByTestId("swim-lane-col-count-carrier");
    expect(badge.textContent?.trim()).toBe("0");
  });
});

// ─── Card content rendering ───────────────────────────────────────────────────

describe("T3SwimLane — card content", () => {
  it("renders case label in card", () => {
    render(<T3SwimLane cases={[HANGAR_CASE]} />);
    const card = screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`);
    expect(card.textContent).toContain("CS-001");
  });

  it("renders subLabel when provided", () => {
    render(<T3SwimLane cases={[ASSEMBLED_CASE]} />);
    const card = screen.getByTestId(`swim-lane-card-${ASSEMBLED_CASE.id}`);
    expect(card.textContent).toContain("Kit Alpha");
  });

  it("does not render subLabel element when not provided", () => {
    render(<T3SwimLane cases={[HANGAR_CASE]} />);
    const card = screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`);
    // Card text should only contain the label — no extra sub-label paragraph
    expect(card.querySelectorAll("p").length).toBe(0);
  });

  it("renders location in card meta", () => {
    render(<T3SwimLane cases={[DEPLOYED_CASE]} />);
    const card = screen.getByTestId(`swim-lane-card-${DEPLOYED_CASE.id}`);
    expect(card.textContent).toContain("Wind Farm North");
  });

  it("renders assignee in card meta", () => {
    render(<T3SwimLane cases={[TRANSIT_OUT_CASE]} />);
    const card = screen.getByTestId(`swim-lane-card-${TRANSIT_OUT_CASE.id}`);
    expect(card.textContent).toContain("FedEx Ground");
  });

  it("renders 'Flagged' text when hasDamage is true", () => {
    render(<T3SwimLane cases={[FLAGGED_CASE]} />);
    const card = screen.getByTestId(`swim-lane-card-${FLAGGED_CASE.id}`);
    expect(card.textContent).toContain("Flagged");
  });

  it("does not render damage indicator when hasDamage is false", () => {
    render(<T3SwimLane cases={[HANGAR_CASE]} />);
    const card = screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`);
    expect(card.textContent).not.toContain("Flagged");
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("T3SwimLane — empty state", () => {
  it("renders empty-state placeholder in each column when cases=[]", () => {
    render(<T3SwimLane cases={[]} />);
    // Each column list should contain the empty-state message
    const lists = screen.getAllByRole("list");
    // 4 card lists (one per column) + 1 for each empty state that contains list items
    // Verify at least 4 lists rendered
    expect(lists.length).toBeGreaterThanOrEqual(4);
  });

  it("renders empty-state title text in Hangar column when no cases", () => {
    render(<T3SwimLane cases={[]} />);
    expect(screen.getByText("No cases in hangar")).toBeTruthy();
  });

  it("renders empty-state title text in Carrier column when no cases", () => {
    render(<T3SwimLane cases={[]} />);
    expect(screen.getByText("No cases in transit")).toBeTruthy();
  });

  it("renders empty-state title text in Field column when no cases", () => {
    render(<T3SwimLane cases={[]} />);
    expect(screen.getByText("No cases deployed")).toBeTruthy();
  });

  it("renders empty-state title text in Returning column when no cases", () => {
    render(<T3SwimLane cases={[]} />);
    expect(screen.getByText("No cases returning")).toBeTruthy();
  });

  it("shows empty state in Carrier column while other columns have cases", () => {
    render(<T3SwimLane cases={[HANGAR_CASE, DEPLOYED_CASE]} />);
    // Carrier column has no cases
    const carrierList = screen.getByTestId("swim-lane-col-list-carrier");
    expect(carrierList.textContent).toContain("No cases in transit");
  });
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("T3SwimLane — loading state", () => {
  it("renders loading skeletons when isLoading=true", () => {
    render(<T3SwimLane isLoading />);
    // Skeleton cards are aria-hidden; they exist in the DOM but not accessible
    const grid = screen.getByTestId("t3-swim-lane");
    const hiddenSkeletons = grid.querySelectorAll("[aria-hidden='true']");
    // 4 columns × 3 skeletons = 12
    expect(hiddenSkeletons.length).toBe(12);
  });

  it("shows … in count badge when loading", () => {
    render(<T3SwimLane isLoading />);
    const badge = screen.getByTestId("swim-lane-col-count-hangar");
    expect(badge.textContent).toBe("…");
  });

  it("renders loading state when cases=undefined", () => {
    render(<T3SwimLane cases={undefined} />);
    const badge = screen.getByTestId("swim-lane-col-count-field");
    expect(badge.textContent).toBe("…");
  });

  it("does not render case cards when loading", () => {
    render(<T3SwimLane isLoading cases={[HANGAR_CASE]} />);
    // isLoading overrides cases — no real cards
    expect(screen.queryByTestId(`swim-lane-card-${HANGAR_CASE.id}`)).toBeNull();
  });
});

// ─── Selection ────────────────────────────────────────────────────────────────

describe("T3SwimLane — selection state", () => {
  it("marks selected card with aria-selected=true", () => {
    render(
      <T3SwimLane
        cases={ALL_CASES}
        selectedCaseId={DEPLOYED_CASE.id}
        onSelectCase={() => undefined}
      />
    );
    const selectedCard = screen.getByTestId(`swim-lane-card-${DEPLOYED_CASE.id}`);
    expect(selectedCard.getAttribute("aria-selected")).toBe("true");
  });

  it("other cards are not aria-selected when one is selected", () => {
    render(
      <T3SwimLane
        cases={ALL_CASES}
        selectedCaseId={DEPLOYED_CASE.id}
        onSelectCase={() => undefined}
      />
    );
    const hangarCard = screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`);
    expect(hangarCard.getAttribute("aria-selected")).toBe("false");
  });

  it("no card is aria-selected when selectedCaseId is undefined", () => {
    render(
      <T3SwimLane
        cases={ALL_CASES}
        onSelectCase={() => undefined}
      />
    );
    const card = screen.getByTestId(`swim-lane-card-${DEPLOYED_CASE.id}`);
    expect(card.getAttribute("aria-selected")).toBe("false");
  });
});

// ─── Click interaction ────────────────────────────────────────────────────────

describe("T3SwimLane — click interaction", () => {
  it("calls onSelectCase with the case ID when card is clicked", () => {
    const onSelect = vi.fn();
    render(
      <T3SwimLane
        cases={[HANGAR_CASE, DEPLOYED_CASE]}
        onSelectCase={onSelect}
      />
    );
    const deployedCard = screen.getByTestId(`swim-lane-card-${DEPLOYED_CASE.id}`);
    fireEvent.click(deployedCard);
    expect(onSelect).toHaveBeenCalledWith(DEPLOYED_CASE.id);
  });

  it("calls onSelectCase with correct id when multiple cards present", () => {
    const onSelect = vi.fn();
    render(<T3SwimLane cases={ALL_CASES} onSelectCase={onSelect} />);
    const card = screen.getByTestId(`swim-lane-card-${TRANSIT_OUT_CASE.id}`);
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(TRANSIT_OUT_CASE.id);
  });

  it("renders interactive button when onSelectCase is provided", () => {
    render(
      <T3SwimLane
        cases={[HANGAR_CASE]}
        onSelectCase={() => undefined}
      />
    );
    const card = screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`);
    expect(card.tagName.toLowerCase()).toBe("button");
  });

  it("renders non-interactive li when onSelectCase is not provided", () => {
    render(<T3SwimLane cases={[HANGAR_CASE]} />);
    const card = screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`);
    expect(card.tagName.toLowerCase()).toBe("li");
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("T3SwimLane — accessibility", () => {
  it("each column has role=region", () => {
    render(<T3SwimLane cases={[]} />);
    const regions = screen.getAllByRole("region");
    expect(regions.length).toBeGreaterThanOrEqual(4);
  });

  it("outer wrapper has role=group", () => {
    render(<T3SwimLane cases={[]} />);
    const group = screen.getByRole("group", { name: "Fleet operations board" });
    expect(group).toBeTruthy();
  });

  it("each case card has an accessible aria-label containing the case label", () => {
    render(
      <T3SwimLane
        cases={[HANGAR_CASE]}
        onSelectCase={() => undefined}
      />
    );
    const card = screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`);
    expect(card.getAttribute("aria-label")).toContain("CS-001");
  });

  it("selected card aria-label contains 'selected'", () => {
    render(
      <T3SwimLane
        cases={[HANGAR_CASE]}
        selectedCaseId={HANGAR_CASE.id}
        onSelectCase={() => undefined}
      />
    );
    const card = screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`);
    expect(card.getAttribute("aria-label")).toContain("selected");
  });

  it("Hangar column has accessible region label with case count", () => {
    render(<T3SwimLane cases={[HANGAR_CASE]} />);
    // Should contain count information
    const col = screen.getByTestId("swim-lane-column-hangar");
    const label = col.getAttribute("aria-label");
    expect(label).toContain("Hangar");
    expect(label).toContain("1 case");
  });

  it("empty column region label says 'empty'", () => {
    render(<T3SwimLane cases={[]} />);
    const col = screen.getByTestId("swim-lane-column-carrier");
    const label = col.getAttribute("aria-label");
    expect(label).toContain("empty");
  });

  it("column count badges have aria-label with case count", () => {
    render(<T3SwimLane cases={[DEPLOYED_CASE, FLAGGED_CASE]} />);
    const countBadge = screen.getByTestId("swim-lane-col-count-field");
    expect(countBadge.getAttribute("aria-label")).toContain("2 cases");
  });
});

// ─── Error state ─────────────────────────────────────────────────────────────

describe("T3SwimLane — error state", () => {
  it("renders error state in all four columns when error is an Error object", () => {
    const err = new Error("Convex connection failed");
    render(<T3SwimLane error={err} />);
    // All four column lists should contain the error message
    const allLists = [
      screen.getByTestId("swim-lane-col-list-hangar"),
      screen.getByTestId("swim-lane-col-list-carrier"),
      screen.getByTestId("swim-lane-col-list-field"),
      screen.getByTestId("swim-lane-col-list-returning"),
    ];
    for (const list of allLists) {
      expect(list.textContent).toContain("Failed to load");
    }
  });

  it("renders error state in all four columns when error is a string", () => {
    render(<T3SwimLane error="Network timeout" />);
    const allLists = [
      screen.getByTestId("swim-lane-col-list-hangar"),
      screen.getByTestId("swim-lane-col-list-carrier"),
      screen.getByTestId("swim-lane-col-list-field"),
      screen.getByTestId("swim-lane-col-list-returning"),
    ];
    for (const list of allLists) {
      expect(list.textContent).toContain("Failed to load");
    }
  });

  it("shows the error message text in each column", () => {
    const err = new Error("Subscription terminated");
    render(<T3SwimLane error={err} />);
    const hangarList = screen.getByTestId("swim-lane-col-list-hangar");
    expect(hangarList.textContent).toContain("Subscription terminated");
  });

  it("shows the string error message in each column", () => {
    render(<T3SwimLane error="Query failed" />);
    const fieldList = screen.getByTestId("swim-lane-col-list-field");
    expect(fieldList.textContent).toContain("Query failed");
  });

  it("shows '!' in the count badge when in error state", () => {
    render(<T3SwimLane error={new Error("oops")} />);
    const badge = screen.getByTestId("swim-lane-col-count-hangar");
    expect(badge.textContent).toBe("!");
  });

  it("shows '!' in all four badges when in error state", () => {
    render(<T3SwimLane error="err" />);
    for (const col of ["hangar", "carrier", "field", "returning"]) {
      const badge = screen.getByTestId(`swim-lane-col-count-${col}`);
      expect(badge.textContent).toBe("!");
    }
  });

  it("renders a 'Try again' button when onRetry is provided", () => {
    render(
      <T3SwimLane
        error={new Error("Connection lost")}
        onRetry={() => undefined}
      />
    );
    const retryButtons = screen.getAllByText("Try again");
    // One button per column × 4 columns
    expect(retryButtons.length).toBe(4);
  });

  it("calls onRetry when 'Try again' button is clicked", () => {
    const onRetry = vi.fn();
    render(
      <T3SwimLane
        error={new Error("Connection lost")}
        onRetry={onRetry}
      />
    );
    const [firstRetryButton] = screen.getAllByText("Try again");
    fireEvent.click(firstRetryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render 'Try again' button when onRetry is not provided", () => {
    render(<T3SwimLane error={new Error("Failed")} />);
    expect(screen.queryByText("Try again")).toBeNull();
  });

  it("error state takes priority over isLoading — no skeleton cards when error is set", () => {
    const err = new Error("Failed");
    const { container } = render(<T3SwimLane error={err} isLoading />);
    // Skeleton cards are <li aria-hidden="true"> — they should not appear.
    // (The error SVG icons also have aria-hidden but are <svg>, not <li>.)
    const skeletonLis = container.querySelectorAll("li[aria-hidden='true']");
    expect(skeletonLis.length).toBe(0);
    // Error placeholder should be present
    const hangarList = screen.getByTestId("swim-lane-col-list-hangar");
    expect(hangarList.textContent).toContain("Failed to load");
  });

  it("error state takes priority over cases data", () => {
    render(
      <T3SwimLane
        error="Stale data"
        cases={[HANGAR_CASE]}
      />
    );
    // Card should not be rendered
    expect(screen.queryByTestId(`swim-lane-card-${HANGAR_CASE.id}`)).toBeNull();
    // Error state should show
    expect(screen.getByTestId("swim-lane-col-list-hangar").textContent).toContain(
      "Failed to load"
    );
  });

  it("null error prop does not trigger error state", () => {
    render(<T3SwimLane error={null} cases={[HANGAR_CASE]} />);
    // null is not an error — card should render normally
    expect(screen.getByTestId(`swim-lane-card-${HANGAR_CASE.id}`)).toBeTruthy();
    // Count badge shows "1", not "!"
    const badge = screen.getByTestId("swim-lane-col-count-hangar");
    expect(badge.textContent).toBe("1");
  });

  it("error state column aria-label says 'failed to load'", () => {
    render(<T3SwimLane error={new Error("oops")} />);
    const col = screen.getByTestId("swim-lane-column-hangar");
    const label = col.getAttribute("aria-label");
    expect(label).toContain("failed to load");
  });

  it("error list item has role=alert for screen reader announcement", () => {
    render(<T3SwimLane error={new Error("oops")} />);
    const alerts = screen.getAllByRole("alert");
    // One alert per column = 4
    expect(alerts.length).toBe(4);
  });
});

// ─── data-column attribute ────────────────────────────────────────────────────

describe("T3SwimLane — data-column attribute", () => {
  it("Hangar column has data-column=hangar", () => {
    render(<T3SwimLane cases={[]} />);
    const col = screen.getByTestId("swim-lane-column-hangar");
    expect(col.getAttribute("data-column")).toBe("hangar");
  });

  it("Carrier column has data-column=carrier", () => {
    render(<T3SwimLane cases={[]} />);
    const col = screen.getByTestId("swim-lane-column-carrier");
    expect(col.getAttribute("data-column")).toBe("carrier");
  });

  it("Field column has data-column=field", () => {
    render(<T3SwimLane cases={[]} />);
    const col = screen.getByTestId("swim-lane-column-field");
    expect(col.getAttribute("data-column")).toBe("field");
  });

  it("Returning column has data-column=returning", () => {
    render(<T3SwimLane cases={[]} />);
    const col = screen.getByTestId("swim-lane-column-returning");
    expect(col.getAttribute("data-column")).toBe("returning");
  });
});
