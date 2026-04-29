/**
 * ItemStatusBadge component unit tests.
 *
 * Tests that:
 *   - All four inspection states render with correct labels
 *   - Icons render with aria-hidden="true" for screen reader cleanliness
 *   - Count display works and is formatted correctly
 *   - ARIA labels are correct for badge + icon variants
 *   - InspectionStatusBar omits zero-count badges by default
 *   - InspectionStatusBar renders all badges when alwaysShow=true
 *   - ItemStatusIcon renders standalone with correct role="img"
 *   - data-status attribute is set correctly for test targeting
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  ItemStatusBadge,
  InspectionStatusBar,
  ItemStatusIcon,
  type ItemInspectionStatus,
} from "../ItemStatusBadge";

afterEach(() => cleanup());

// ─── ItemStatusBadge — label rendering ───────────────────────────────────────

describe("ItemStatusBadge — label rendering", () => {
  const LABEL_CASES: Array<[ItemInspectionStatus, string]> = [
    ["verified",  "Verified"],
    ["flagged",   "Flagged"],
    ["missing",   "Missing"],
    ["unchecked", "Unchecked"],
  ];

  it.each(LABEL_CASES)('renders status "%s" with label "%s"', (status, label) => {
    render(<ItemStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});

// ─── ItemStatusBadge — count display ─────────────────────────────────────────

describe("ItemStatusBadge — count display", () => {
  it("renders count number when count is provided", () => {
    render(<ItemStatusBadge status="verified" count={5} />);
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders count 0 when count is 0", () => {
    render(<ItemStatusBadge status="missing" count={0} />);
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("does not render count element when count is undefined", () => {
    const { container } = render(<ItemStatusBadge status="verified" />);
    // Count span has aria-hidden="true", not labelled separately
    // Verify the count text is not present
    const badge = container.firstChild as HTMLElement;
    // Only the icon and label should be present (no count number)
    const monospace = badge.querySelector('[class*="badgeCount"]');
    expect(monospace).toBeNull();
  });

  it("renders correct ARIA label with count and singular", () => {
    render(<ItemStatusBadge status="verified" count={1} />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("1 verified item");
  });

  it("renders correct ARIA label with count and plural", () => {
    render(<ItemStatusBadge status="missing" count={3} />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("3 missing items");
  });

  it("renders correct ARIA label with count 0", () => {
    render(<ItemStatusBadge status="flagged" count={0} />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("0 flagged items");
  });

  it("renders fallback ARIA label when no count provided", () => {
    render(<ItemStatusBadge status="unchecked" />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("Unchecked");
  });

  it("allows ARIA label override", () => {
    render(<ItemStatusBadge status="verified" count={7} aria-label="7 items verified" />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("7 items verified");
  });
});

// ─── ItemStatusBadge — data attributes ───────────────────────────────────────

describe("ItemStatusBadge — data-status attribute", () => {
  const STATUSES: ItemInspectionStatus[] = ["verified", "flagged", "missing", "unchecked"];

  it.each(STATUSES)('sets data-status="%s"', (status) => {
    render(<ItemStatusBadge status={status} />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("data-status")).toBe(status);
  });
});

// ─── ItemStatusBadge — showIcon and showLabel props ──────────────────────────

describe("ItemStatusBadge — showIcon / showLabel props", () => {
  it("hides label when showLabel=false", () => {
    render(<ItemStatusBadge status="verified" showLabel={false} />);
    expect(screen.queryByText("Verified")).toBeNull();
  });

  it("still renders status role element when showLabel=false", () => {
    render(<ItemStatusBadge status="missing" showLabel={false} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("icon has aria-hidden when embedded in badge", () => {
    const { container } = render(<ItemStatusBadge status="flagged" showIcon />);
    const svgs = container.querySelectorAll("svg");
    // All SVG icons should be decorative (aria-hidden)
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("renders without icon when showIcon=false", () => {
    const { container } = render(<ItemStatusBadge status="verified" showIcon={false} />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(0);
  });
});

// ─── ItemStatusBadge — filled variant ────────────────────────────────────────

describe("ItemStatusBadge — filled variant", () => {
  it("renders without error in filled mode", () => {
    const FILLED_CASES: ItemInspectionStatus[] = ["verified", "flagged", "missing", "unchecked"];
    for (const status of FILLED_CASES) {
      const { unmount } = render(<ItemStatusBadge status={status} filled count={3} />);
      expect(screen.getByRole("status")).toBeTruthy();
      unmount();
    }
  });
});

// ─── ItemStatusBadge — size prop ─────────────────────────────────────────────

describe("ItemStatusBadge — size prop", () => {
  it("renders without error at sm size", () => {
    render(<ItemStatusBadge status="verified" size="sm" count={2} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders without error at md size (default)", () => {
    render(<ItemStatusBadge status="flagged" size="md" count={1} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders without error at lg size", () => {
    render(<ItemStatusBadge status="missing" size="lg" count={0} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

// ─── ItemStatusIcon — standalone ─────────────────────────────────────────────

describe("ItemStatusIcon — standalone icon", () => {
  it("renders with role='img'", () => {
    render(<ItemStatusIcon status="verified" />);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("sets default aria-label to status display name", () => {
    render(<ItemStatusIcon status="missing" />);
    const el = screen.getByRole("img");
    expect(el.getAttribute("aria-label")).toBe("Missing");
  });

  it.each(
    [
      ["verified",  "Verified"],
      ["flagged",   "Flagged"],
      ["missing",   "Missing"],
      ["unchecked", "Unchecked"],
    ] as Array<[ItemInspectionStatus, string]>
  )('"%s" icon has aria-label "%s"', (status, label) => {
    render(<ItemStatusIcon status={status} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(label);
  });

  it("accepts custom aria-label", () => {
    render(<ItemStatusIcon status="flagged" aria-label="Custom label" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Custom label");
  });

  it("renders SVG icon inside the wrapper", () => {
    const { container } = render(<ItemStatusIcon status="verified" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("SVG is aria-hidden (wrapper has the img role)", () => {
    const { container } = render(<ItemStatusIcon status="missing" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});

// ─── InspectionStatusBar — rendering ─────────────────────────────────────────

describe("InspectionStatusBar — rendering", () => {
  it("renders nothing when all counts are 0", () => {
    const { container } = render(
      <InspectionStatusBar verified={0} flagged={0} missing={0} unchecked={0} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders only non-zero status badges by default", () => {
    render(
      <InspectionStatusBar verified={5} flagged={0} missing={2} unchecked={0} />
    );
    // verified=5 → shown; missing=2 → shown; flagged=0, unchecked=0 → hidden
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
    expect(screen.queryByText("Flagged")).toBeNull();
    expect(screen.queryByText("Unchecked")).toBeNull();
  });

  it("renders all badges when alwaysShow=true, including zero counts", () => {
    render(
      <InspectionStatusBar
        verified={5}
        flagged={0}
        missing={0}
        unchecked={3}
        alwaysShow
      />
    );
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Flagged")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
    expect(screen.getByText("Unchecked")).toBeTruthy();
  });

  it("renders the correct counts", () => {
    render(
      <InspectionStatusBar verified={10} flagged={3} missing={1} unchecked={6} />
    );
    // count numbers are in separate spans with aria-hidden
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("renders the container with role='group'", () => {
    render(<InspectionStatusBar verified={1} />);
    const container = screen.getByRole("group");
    expect(container).toBeTruthy();
    expect(container.getAttribute("aria-label")).toBe("Inspection status summary");
  });

  it("renders with data-testid='inspection-status-bar'", () => {
    const { container } = render(<InspectionStatusBar verified={1} />);
    expect(container.querySelector('[data-testid="inspection-status-bar"]')).not.toBeNull();
  });

  it("defaults to all zeros when no props provided", () => {
    const { container } = render(<InspectionStatusBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders single badge when only missing count provided", () => {
    render(<InspectionStatusBar missing={4} />);
    // Only "Missing" badge should render
    expect(screen.getByText("Missing")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.queryByText("Flagged")).toBeNull();
    expect(screen.queryByText("Unchecked")).toBeNull();
  });
});

// ─── InspectionStatusBar — visual ordering ───────────────────────────────────

describe("InspectionStatusBar — badge ordering", () => {
  it("renders badges in verified → flagged → missing → unchecked order", () => {
    render(
      <InspectionStatusBar verified={1} flagged={2} missing={3} unchecked={4} />
    );
    const statusBadges = screen.getAllByRole("status");
    // Each badge has an aria-label reflecting its status
    const ariaLabels = statusBadges.map((el) => el.getAttribute("aria-label") ?? "");
    expect(ariaLabels[0]).toContain("verified");
    expect(ariaLabels[1]).toContain("flagged");
    expect(ariaLabels[2]).toContain("missing");
    expect(ariaLabels[3]).toContain("unchecked");
  });
});
