/**
 * @vitest-environment jsdom
 *
 * Unit tests for ManifestItemList — pure presentational item list sub-component.
 *
 * Test strategy
 * ─────────────
 * - No Convex or hook mocking — component is purely prop-driven.
 * - ItemStatusIcon is mocked to a lightweight stub so tests do not depend
 *   on SVG rendering details.
 * - Assertions use plain Vitest matchers (no @testing-library/jest-dom extensions).
 *
 * Covered scenarios
 * ─────────────────
 *  1.  Empty items — renders null when no emptyText provided
 *  2.  Empty items — renders emptyText message when provided
 *  3.  Item count  — renders one <li> per item
 *  4.  Item names  — each item name appears in the rendered output
 *  5.  Quantity display: provided → shows "×N", absent → nothing
 *  6.  Status labels: verified / flagged / missing / unchecked
 *  7.  aria-label on <li>: name + status (no quantity)
 *  8.  aria-label on <li>: name + quantity + status
 *  9.  data-status attribute on <li>: all four states
 * 10.  Status indicator data-status attribute for CSS targeting
 * 11.  Notes line: shown when present, absent when not
 * 12.  Attribution line: shown when checkedByName present, absent otherwise
 * 13.  ManifestItemRow: renders a single row from props
 * 14.  Aria-label on the <ul> list container
 * 15.  Custom testId propagated to list container
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Mock ItemStatusIcon ──────────────────────────────────────────────────────

vi.mock("@/components/ItemStatusBadge", () => ({
  ItemStatusIcon: ({ status }: { status: string }) => (
    <span data-testid="status-icon" data-status-icon={status} aria-hidden="true" />
  ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  ManifestItemList,
  ManifestItemRow,
  type ManifestItemListItem,
} from "../ManifestItemList";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeItem(
  id: string,
  name: string,
  status: ManifestItemListItem["status"],
  extras?: Partial<ManifestItemListItem>
): ManifestItemListItem {
  return { id, name, status, ...extras };
}

const ALL_ITEMS: ManifestItemListItem[] = [
  makeItem("i1", "Drone Body",     "verified",  { quantity: 1, checkedByName: "Alice" }),
  makeItem("i2", "Battery Pack",   "flagged",   { quantity: 2, notes: "Minor scuff" }),
  makeItem("i3", "Remote Control", "missing"),
  makeItem("i4", "Charger",        "unchecked", { quantity: 3 }),
  makeItem("i5", "Landing Pad",    "verified"),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

afterEach(cleanup);

// ─── ManifestItemList tests ───────────────────────────────────────────────────

describe("ManifestItemList", () => {

  // ── 1. Empty items — no emptyText ───────────────────────────────────────────

  it("renders nothing (null) when items is empty and no emptyText is provided", () => {
    const { container } = render(<ManifestItemList items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  // ── 2. Empty items — with emptyText ─────────────────────────────────────────

  it("renders emptyText message when items is empty and emptyText is provided", () => {
    render(<ManifestItemList items={[]} emptyText="No items found" />);
    expect(screen.getByText("No items found")).toBeTruthy();
    expect(screen.getByTestId("manifest-item-list-empty")).toBeTruthy();
  });

  it("renders emptyText container with role='status' for live region", () => {
    render(<ManifestItemList items={[]} emptyText="Nothing here" />);
    const el = screen.getByRole("status");
    expect(el).toBeTruthy();
  });

  // ── 3. Item count ────────────────────────────────────────────────────────────

  it("renders one row per item", () => {
    render(<ManifestItemList items={ALL_ITEMS} />);
    expect(screen.getAllByTestId("manifest-item-row")).toHaveLength(ALL_ITEMS.length);
  });

  // ── 4. Item names ────────────────────────────────────────────────────────────

  it("renders all item names", () => {
    render(<ManifestItemList items={ALL_ITEMS} />);
    for (const item of ALL_ITEMS) {
      expect(screen.getByText(item.name)).toBeTruthy();
    }
  });

  // ── 5a. Quantity: shown when provided ────────────────────────────────────────

  it("renders quantity badge when quantity is provided", () => {
    render(<ManifestItemList items={[makeItem("q1", "Battery Pack", "flagged", { quantity: 3 })]} />);
    // Badge shows "× 3" (× thin-space 3)
    const badge = screen.getByText(/×/);
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("3");
  });

  // ── 5b. Quantity: absent when not provided ──────────────────────────────────

  it("does not render quantity badge when quantity is absent", () => {
    render(<ManifestItemList items={[makeItem("q2", "Charger", "unchecked")]} />);
    expect(screen.queryByText(/×/)).toBeNull();
  });

  // ── 5c. Quantity: absent when quantity is 0 ─────────────────────────────────

  it("does not render quantity badge when quantity is 0", () => {
    render(<ManifestItemList items={[makeItem("q3", "Charger", "unchecked", { quantity: 0 })]} />);
    expect(screen.queryByText(/×/)).toBeNull();
  });

  // ── 6. Status labels ─────────────────────────────────────────────────────────

  it.each([
    ["verified",  "Verified"],
    ["flagged",   "Flagged"],
    ["missing",   "Missing"],
    ["unchecked", "Unchecked"],
  ] as const)(
    "renders StatusIndicator with label '%s' for status '%s'",
    (status, label) => {
      render(<ManifestItemList items={[makeItem("s1", "Item", status)]} />);
      expect(screen.getByText(label)).toBeTruthy();
    }
  );

  // ── 7. aria-label — name + status (no quantity) ──────────────────────────────

  it("sets aria-label 'Item: Verified' when no quantity", () => {
    render(<ManifestItemList items={[makeItem("a1", "Drone Body", "verified")]} />);
    const row = screen.getByTestId("manifest-item-row");
    expect(row.getAttribute("aria-label")).toBe("Drone Body: Verified");
  });

  it("sets aria-label 'Item: Missing' when no quantity", () => {
    render(<ManifestItemList items={[makeItem("a2", "Remote Control", "missing")]} />);
    const row = screen.getByTestId("manifest-item-row");
    expect(row.getAttribute("aria-label")).toBe("Remote Control: Missing");
  });

  // ── 8. aria-label — name + quantity + status ─────────────────────────────────

  it("includes quantity in aria-label when quantity is provided", () => {
    render(<ManifestItemList items={[makeItem("a3", "Battery Pack", "flagged", { quantity: 2 })]} />);
    const row = screen.getByTestId("manifest-item-row");
    expect(row.getAttribute("aria-label")).toBe("Battery Pack, quantity 2: Flagged");
  });

  // ── 9. data-status attribute on <li> ─────────────────────────────────────────

  it.each(["verified", "flagged", "missing", "unchecked"] as const)(
    "sets data-status='%s' on the row element",
    (status) => {
      render(<ManifestItemList items={[makeItem("ds1", "Item", status)]} />);
      const row = screen.getByTestId("manifest-item-row");
      expect(row.getAttribute("data-status")).toBe(status);
    }
  );

  // ── 10. StatusIndicator data-status for CSS targeting ────────────────────────

  it("sets data-status on the StatusIndicator span", () => {
    const { container } = render(
      <ManifestItemList items={[makeItem("si1", "Item", "missing")]} />
    );
    const indicator = container.querySelector('[class*="statusIndicator"]');
    expect(indicator).not.toBeNull();
    expect(indicator!.getAttribute("data-status")).toBe("missing");
  });

  // ── 11. Notes line ───────────────────────────────────────────────────────────

  it("renders notes when present", () => {
    render(<ManifestItemList items={[makeItem("n1", "Battery Pack", "flagged", { notes: "Minor scuff" })]} />);
    expect(screen.getByText("Minor scuff")).toBeTruthy();
  });

  it("does not render notes line when notes is absent", () => {
    render(<ManifestItemList items={[makeItem("n2", "Landing Pad", "verified")]} />);
    expect(screen.queryByText(/scuff/i)).toBeNull();
  });

  // ── 12. Attribution line ─────────────────────────────────────────────────────

  it("renders attribution line when checkedByName is set", () => {
    render(
      <ManifestItemList items={[makeItem("c1", "Drone Body", "verified", { checkedByName: "Alice" })]} />
    );
    expect(screen.getByText(/Verified by Alice/)).toBeTruthy();
  });

  it("does not render attribution line when checkedByName is absent", () => {
    render(<ManifestItemList items={[makeItem("c2", "Landing Pad", "verified")]} />);
    expect(screen.queryByText(/Verified by/)).toBeNull();
  });

  it("renders correct attribution for flagged status", () => {
    render(
      <ManifestItemList items={[makeItem("c3", "Battery", "flagged", { checkedByName: "Bob" })]} />
    );
    expect(screen.getByText(/Flagged by Bob/)).toBeTruthy();
  });

  // ── 14. aria-label on list container ─────────────────────────────────────────

  it("uses default aria-label 'Manifest items' on the list", () => {
    render(<ManifestItemList items={ALL_ITEMS} />);
    const list = screen.getByRole("list", { name: "Manifest items" });
    expect(list).toBeTruthy();
  });

  it("accepts custom aria-label on the list", () => {
    render(<ManifestItemList items={ALL_ITEMS} aria-label="Flagged items for Case 007" />);
    const list = screen.getByRole("list", { name: "Flagged items for Case 007" });
    expect(list).toBeTruthy();
  });

  // ── 15. Custom testId ────────────────────────────────────────────────────────

  it("applies custom testId to the list container", () => {
    render(<ManifestItemList items={ALL_ITEMS} testId="custom-list" />);
    expect(screen.getByTestId("custom-list")).toBeTruthy();
  });

  it("applies default testId 'manifest-item-list' when not specified", () => {
    render(<ManifestItemList items={ALL_ITEMS} />);
    expect(screen.getByTestId("manifest-item-list")).toBeTruthy();
  });

});

// ─── ManifestItemRow tests ────────────────────────────────────────────────────

describe("ManifestItemRow", () => {

  // ── 13. Single row rendering ─────────────────────────────────────────────────

  it("renders a single item row with name and status label", () => {
    render(
      <ul>
        <ManifestItemRow
          item={{ id: "r1", name: "Drone Body", status: "verified", quantity: 1 }}
        />
      </ul>
    );
    expect(screen.getByText("Drone Body")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
  });

  it("renders quantity badge when provided", () => {
    render(
      <ul>
        <ManifestItemRow
          item={{ id: "r2", name: "Battery Pack", status: "flagged", quantity: 4 }}
        />
      </ul>
    );
    const badge = screen.getByText(/×/);
    expect(badge.textContent).toContain("4");
  });

  it("renders with correct data-testid default", () => {
    render(
      <ul>
        <ManifestItemRow item={{ id: "r3", name: "Charger", status: "unchecked" }} />
      </ul>
    );
    expect(screen.getByTestId("manifest-item-row")).toBeTruthy();
  });

  it("accepts custom testId override", () => {
    render(
      <ul>
        <ManifestItemRow
          item={{ id: "r4", name: "Remote", status: "missing" }}
          testId="my-row"
        />
      </ul>
    );
    expect(screen.getByTestId("my-row")).toBeTruthy();
  });

  it("passes the correct status to ItemStatusIcon", () => {
    render(
      <ul>
        <ManifestItemRow item={{ id: "r5", name: "Pad", status: "missing" }} />
      </ul>
    );
    const icon = screen.getByTestId("status-icon");
    expect(icon.getAttribute("data-status-icon")).toBe("missing");
  });

});
