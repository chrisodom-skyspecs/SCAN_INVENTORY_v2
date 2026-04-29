/**
 * @vitest-environment jsdom
 *
 * Unit tests for ManifestPanel — manifest item container component.
 *
 * Test strategy
 * ─────────────
 * - `useChecklistByCase` is mocked to control the returned item list and
 *   test all lifecycle states: loading, empty, filtered-empty, and populated.
 * - `StatusPill` is stubbed as a transparent pass-through so we can assert
 *   which `kind` value is passed without rendering the full component.
 * - No Convex runtime is instantiated; the hook mock covers all data paths.
 * - Assertions use plain Vitest matchers (.toBeTruthy(), .getAttribute(), etc.)
 *   since the project does not configure @testing-library/jest-dom.
 *
 * Covered scenarios
 * ─────────────────
 * 1.  Loading state — renders skeleton rows when items === undefined.
 * 2.  Empty state   — renders contextual message when items is an empty array.
 * 3.  Data state    — renders item row for each item in the list.
 * 4.  Item names    — all item names appear in the rendered output.
 * 5.  Status mapping:
 *       "ok"        → "completed" StatusPill kind (Verified label)
 *       "damaged"   → "flagged"   StatusPill kind (Flagged label)
 *       "missing"   → "exception" StatusPill kind (Missing label)
 *       "unchecked" → "pending"   StatusPill kind (Unchecked label)
 * 6.  aria-label on item rows uses display terms (Verified/Flagged/Missing).
 * 7.  Summary chips — verified/flagged/missing counts shown in header.
 * 8.  Progress bar  — progressbar role + correct aria-valuenow.
 * 9.  showProgress=false — hides progress bar.
 * 10. Filter bar    — renders filter buttons when showFilters=true.
 * 11. showFilters=false — hides filter toolbar.
 * 12. Filter click  — only matching items rendered after filter click.
 * 13. Filter empty  — filtered empty-state when no items match.
 * 14. No caseId     — component renders nothing (returns null).
 * 15. Item notes    — note text rendered when present.
 * 16. Checker attribution — attribution line rendered when checkedByName set.
 * 17. No attribution — attribution line absent when checkedByName not set.
 * 18. Hook called with caseId — useChecklistByCase receives correct caseId.
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

// ─── Mock useChecklistByCase ───────────────────────────────────────────────────

const mockUseChecklistByCase = vi.fn();

vi.mock("@/hooks/use-checklist", () => ({
  useChecklistByCase: (...args: unknown[]) => mockUseChecklistByCase(...args),
  MANIFEST_ITEM_STATUSES: ["unchecked", "ok", "damaged", "missing"],
}));

// ─── Mock StatusPill ──────────────────────────────────────────────────────────

vi.mock("@/components/StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind}>{kind}</span>
  ),
}));

// ─── Import component after mocks ─────────────────────────────────────────────

import { ManifestPanel } from "../ManifestPanel";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = "kx7abc123" as const;

function makeItem(
  id: string,
  name: string,
  status: "unchecked" | "ok" | "damaged" | "missing",
  extras?: Partial<{
    notes: string;
    checkedByName: string;
    checkedAt: number;
  }>
) {
  return {
    _id: id,
    _creationTime: 1_700_000_000_000,
    caseId: CASE_ID,
    templateItemId: `tpl-${id}`,
    name,
    status,
    ...extras,
  };
}

const ALL_ITEMS = [
  makeItem("i1", "Drone Body",     "ok",        { checkedByName: "Alice", checkedAt: 1_700_000_000_000 }),
  makeItem("i2", "Battery Pack",   "damaged",   { notes: "Minor scuff on corner" }),
  makeItem("i3", "Remote Control", "missing"),
  makeItem("i4", "Charger",        "unchecked"),
  makeItem("i5", "Landing Pad",    "ok"),
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ManifestPanel", () => {
  beforeEach(() => {
    mockUseChecklistByCase.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Loading state ────────────────────────────────────────────────────────

  it("renders skeleton loader while items are loading (undefined)", () => {
    mockUseChecklistByCase.mockReturnValue(undefined);

    render(<ManifestPanel caseId={CASE_ID} />);

    const skeleton = screen.getByTestId("manifest-skeleton");
    expect(skeleton).toBeTruthy();
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryAllByTestId("manifest-item")).toHaveLength(0);
  });

  it("renders the Packing List heading while loading", () => {
    mockUseChecklistByCase.mockReturnValue(undefined);
    render(<ManifestPanel caseId={CASE_ID} />);
    expect(screen.getByText("Packing List")).toBeTruthy();
  });

  // ── 2. Empty state ──────────────────────────────────────────────────────────

  it("renders empty state message when case has no manifest items", () => {
    mockUseChecklistByCase.mockReturnValue([]);

    render(<ManifestPanel caseId={CASE_ID} />);

    expect(screen.getByTestId("manifest-empty")).toBeTruthy();
    expect(screen.getByText("No manifest items")).toBeTruthy();
    expect(screen.getByText(/Apply a case template/)).toBeTruthy();
  });

  // ── 3. Data state — basic render ────────────────────────────────────────────

  it("renders one item row per manifest item", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} />);
    expect(screen.getAllByTestId("manifest-item")).toHaveLength(ALL_ITEMS.length);
  });

  // ── 4. Item names ────────────────────────────────────────────────────────────

  it("displays all item names", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} />);

    for (const item of ALL_ITEMS) {
      expect(screen.getByText(item.name)).toBeTruthy();
    }
  });

  // ── 5. Status to StatusPill kind mapping ──────────────────────────────────────

  it.each([
    ["ok",        "completed"],
    ["damaged",   "flagged"],
    ["missing",   "exception"],
    ["unchecked", "pending"],
  ] as const)(
    "passes StatusPill kind='%s' for manifest item status '%s'",
    (status, expectedKind) => {
      mockUseChecklistByCase.mockReturnValue([makeItem("s1", "Test Item", status)]);
      render(<ManifestPanel caseId={CASE_ID} />);
      // Use getAllByTestId to handle any edge case of multiple pills
      const pills = screen.getAllByTestId("status-pill");
      // There should be exactly one pill (one item rendered)
      expect(pills).toHaveLength(1);
      expect(pills[0].getAttribute("data-kind")).toBe(expectedKind);
    }
  );

  // ── 6. aria-label uses display terminology ────────────────────────────────────

  it("sets aria-label 'Verified' on an ok item", () => {
    mockUseChecklistByCase.mockReturnValue([makeItem("a1", "Drone Body", "ok")]);
    render(<ManifestPanel caseId={CASE_ID} />);
    const row = screen.getByTestId("manifest-item");
    expect(row.getAttribute("aria-label")).toBe("Drone Body: Verified");
  });

  it("sets aria-label 'Flagged' on a damaged item", () => {
    mockUseChecklistByCase.mockReturnValue([makeItem("a2", "Battery Pack", "damaged")]);
    render(<ManifestPanel caseId={CASE_ID} />);
    const row = screen.getByTestId("manifest-item");
    expect(row.getAttribute("aria-label")).toBe("Battery Pack: Flagged");
  });

  it("sets aria-label 'Missing' on a missing item", () => {
    mockUseChecklistByCase.mockReturnValue([makeItem("a3", "Remote Control", "missing")]);
    render(<ManifestPanel caseId={CASE_ID} />);
    const row = screen.getByTestId("manifest-item");
    expect(row.getAttribute("aria-label")).toBe("Remote Control: Missing");
  });

  it("sets aria-label 'Unchecked' on an unchecked item", () => {
    mockUseChecklistByCase.mockReturnValue([makeItem("a4", "Charger", "unchecked")]);
    render(<ManifestPanel caseId={CASE_ID} />);
    const row = screen.getByTestId("manifest-item");
    expect(row.getAttribute("aria-label")).toBe("Charger: Unchecked");
  });

  // ── 7. Summary chips (InspectionStatusBar) ───────────────────────────────────
  //
  // The ManifestPanel header now renders <InspectionStatusBar /> which produces
  // <ItemStatusBadge /> elements identified by role="status" + data-status="*".
  // The old summary-chip-* data-testids are replaced by data-status attributes.

  it("shows verified count chip when items have ok status", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    const { container } = render(<ManifestPanel caseId={CASE_ID} />);
    // InspectionStatusBar renders ItemStatusBadge with data-status="verified"
    // within the inspection-status-bar container
    const bar = container.querySelector('[data-testid="inspection-status-bar"]');
    expect(bar).toBeTruthy();
    const chip = bar!.querySelector('[data-status="verified"]');
    expect(chip).toBeTruthy();
    // aria-label encodes the count: "2 verified items"
    expect(chip!.getAttribute("aria-label")).toBe("2 verified items");
  });

  it("shows flagged count chip when items have damaged status", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    const { container } = render(<ManifestPanel caseId={CASE_ID} />);
    const bar = container.querySelector('[data-testid="inspection-status-bar"]');
    expect(bar).toBeTruthy();
    const chip = bar!.querySelector('[data-status="flagged"]');
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("aria-label")).toBe("1 flagged item");
  });

  it("shows missing count chip when items have missing status", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    const { container } = render(<ManifestPanel caseId={CASE_ID} />);
    const bar = container.querySelector('[data-testid="inspection-status-bar"]');
    expect(bar).toBeTruthy();
    const chip = bar!.querySelector('[data-status="missing"]');
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("aria-label")).toBe("1 missing item");
  });

  it("hides verified chip when no items have ok status", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("h1", "A", "missing"),
      makeItem("h2", "B", "unchecked"),
    ]);
    const { container } = render(<ManifestPanel caseId={CASE_ID} />);
    // InspectionStatusBar omits badges with count=0 — no verified badge rendered
    const bar = container.querySelector('[data-testid="inspection-status-bar"]');
    const verifiedChip = bar ? bar.querySelector('[data-status="verified"]') : null;
    expect(verifiedChip).toBeNull();
  });

  // ── 8. Progress bar ──────────────────────────────────────────────────────────

  it("renders a progressbar with correct aria-valuenow", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} />);

    // 4 of 5 items reviewed (ok x2, damaged x1, missing x1) = 80%
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeTruthy();
    expect(bar.getAttribute("aria-valuenow")).toBe("80");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  // ── 9. showProgress=false ────────────────────────────────────────────────────

  it("hides progress bar when showProgress=false", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} showProgress={false} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  // ── 10. Filter bar ────────────────────────────────────────────────────────────

  it("renders filter group with five buttons when showFilters=true", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} />);

    const filterGroup = screen.getByRole("group", { name: /Filter manifest items/i });
    expect(filterGroup).toBeTruthy();

    const buttons = within(filterGroup).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(5);
  });

  // ── 11. showFilters=false ────────────────────────────────────────────────────

  it("hides filter bar when showFilters=false", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} showFilters={false} />);
    expect(screen.queryByRole("group", { name: /Filter manifest items/i })).toBeNull();
  });

  // ── 12. Filter activation ─────────────────────────────────────────────────────

  it("shows only ok items after clicking the Verified filter", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Show verified items/i }));

    const rows = screen.getAllByTestId("manifest-item");
    expect(rows).toHaveLength(2); // Drone Body + Landing Pad
    for (const row of rows) {
      expect(row.getAttribute("data-status")).toBe("ok");
    }
  });

  it("shows only damaged items after clicking the Flagged filter", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Show flagged items/i }));

    const rows = screen.getAllByTestId("manifest-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-status")).toBe("damaged");
  });

  it("shows only missing items after clicking the Missing filter", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Show missing items/i }));

    const rows = screen.getAllByTestId("manifest-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-status")).toBe("missing");
  });

  it("restores all items after clicking the All filter", () => {
    mockUseChecklistByCase.mockReturnValue(ALL_ITEMS);
    render(<ManifestPanel caseId={CASE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Show missing items/i }));
    fireEvent.click(screen.getByRole("button", { name: /Show all items/i }));

    expect(screen.getAllByTestId("manifest-item")).toHaveLength(ALL_ITEMS.length);
  });

  // ── 13. Filter empty state ────────────────────────────────────────────────────

  it("shows filtered empty-state when active filter matches no items", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("fe1", "Drone Body", "ok"),
      makeItem("fe2", "Landing Pad", "ok"),
    ]);
    render(<ManifestPanel caseId={CASE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Show missing items/i }));

    expect(screen.getByTestId("manifest-empty-filtered")).toBeTruthy();
    expect(screen.getByText("No items match this filter")).toBeTruthy();
  });

  // ── 14. No caseId ─────────────────────────────────────────────────────────────

  it("renders nothing when caseId is null", () => {
    mockUseChecklistByCase.mockReturnValue(undefined);
    const { container } = render(<ManifestPanel caseId={null} />);
    expect(container.firstChild).toBeNull();
  });

  // ── 15. Item notes ─────────────────────────────────────────────────────────────

  it("renders item note text when present", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("n1", "Battery Pack", "damaged", { notes: "Minor scuff on corner" }),
    ]);
    render(<ManifestPanel caseId={CASE_ID} />);
    expect(screen.getByText("Minor scuff on corner")).toBeTruthy();
  });

  it("does not render note element when notes is absent", () => {
    mockUseChecklistByCase.mockReturnValue([makeItem("n2", "Landing Pad", "ok")]);
    render(<ManifestPanel caseId={CASE_ID} />);
    expect(screen.queryByText(/scuff/i)).toBeNull();
  });

  // ── 16. Checker attribution ───────────────────────────────────────────────────

  it("renders 'Verified by Alice' attribution when checkedByName is set on an ok item", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("c1", "Drone Body", "ok", {
        checkedByName: "Alice",
        checkedAt: 1_700_000_000_000,
      }),
    ]);
    render(<ManifestPanel caseId={CASE_ID} />);
    expect(screen.getByText(/Verified by Alice/)).toBeTruthy();
  });

  // ── 17. No attribution without checkedByName ──────────────────────────────────

  it("does not render attribution line when checkedByName is absent", () => {
    mockUseChecklistByCase.mockReturnValue([makeItem("c2", "Landing Pad", "ok")]);
    render(<ManifestPanel caseId={CASE_ID} />);
    expect(screen.queryByText(/Verified by/)).toBeNull();
  });

  // ── 18. Hook receives caseId ───────────────────────────────────────────────────

  it("calls useChecklistByCase with the provided caseId", () => {
    mockUseChecklistByCase.mockReturnValue([]);
    render(<ManifestPanel caseId={CASE_ID} />);
    expect(mockUseChecklistByCase).toHaveBeenCalledWith(CASE_ID);
  });
});
