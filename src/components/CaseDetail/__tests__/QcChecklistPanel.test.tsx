/**
 * @vitest-environment jsdom
 *
 * QcChecklistPanel.test.tsx
 *
 * Unit tests for the read-only QC checklist display component.
 *
 * The QcChecklistPanel renders case manifest items with condition status
 * indicators (pass / fail / needs-review) sourced from the Convex
 * `manifestItems` table via the `useChecklistByCase` subscription.
 *
 * Test strategy
 * ─────────────
 * • useChecklistByCase is mocked so we can control all data states without
 *   a live Convex environment.
 * • StatusPill is mocked as a transparent span so we can assert the `kind`
 *   prop without rendering full CSS module dependencies.
 * • CSS modules are mocked as empty objects to avoid style processing errors.
 *
 * Coverage matrix
 * ───────────────
 *
 * Render states:
 *   ✓ renders loading skeleton while checklist is loading (undefined)
 *   ✓ loading element has aria-busy="true"
 *   ✓ renders empty state when case has no manifest items
 *   ✓ renders item list when items are present
 *   ✓ passes caseId to useChecklistByCase
 *
 * Read-only contract:
 *   ✓ renders no interactive controls (no buttons, no inputs, no selects)
 *   ✓ renders no filter bar
 *
 * Section header:
 *   ✓ renders "QC Checklist" section title
 *   ✓ shows item count in header for 1 item ("1 item")
 *   ✓ shows item count in header for multiple items ("N items")
 *
 * Summary counts row:
 *   ✓ shows pass count when ok items exist
 *   ✓ shows fail count when damaged/missing items exist
 *   ✓ shows needs-review count when unchecked items exist
 *   ✓ does not show pass count when no ok items
 *   ✓ does not show fail count when no damaged/missing items
 *
 * Status-to-StatusPill mapping:
 *   ✓ "ok" item → "completed" StatusPill kind
 *   ✓ "damaged" item → "flagged" StatusPill kind
 *   ✓ "missing" item → "exception" StatusPill kind
 *   ✓ "unchecked" item → "pending" StatusPill kind
 *
 * Item display:
 *   ✓ renders all item names from the checklist
 *   ✓ each item has correct data-status attribute
 *   ✓ item aria-label includes item name and status label
 *   ✓ "ok" item aria-label says "Pass"
 *   ✓ "damaged" item aria-label says "Fail – damaged"
 *   ✓ "missing" item aria-label says "Fail – missing"
 *   ✓ "unchecked" item aria-label says "Needs review"
 *
 * Notes:
 *   ✓ renders item note when present
 *   ✓ does not render note element when absent
 *
 * Attribution:
 *   ✓ renders attribution for reviewed items (ok/damaged/missing) when
 *     checkedByName and checkedAt are present
 *   ✓ does not render attribution for unchecked items even if checkedByName set
 *   ✓ does not render attribution when checkedByName is absent
 *
 * Real-time subscription wiring:
 *   ✓ re-renders when subscription data changes (Convex push simulation)
 *   ✓ item count updates correctly after re-render
 *   ✓ status pills update after item status change
 */

import React from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// useChecklistByCase — controls loading / empty / populated states
const mockUseChecklistByCase = vi.fn();
vi.mock("../../../queries/checklist", () => ({
  useChecklistByCase: (...args: unknown[]) => mockUseChecklistByCase(...args),
}));

// StatusPill — transparent stub so we can assert the `kind` prop
vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind}>{kind}</span>
  ),
}));

// CSS modules — mock as empty objects to avoid css-modules processing
vi.mock("../QcChecklistPanel.module.css", () => ({ default: {} }));
vi.mock("../shared.module.css", () => ({ default: {} }));

// ─── Import SUT after mocks ───────────────────────────────────────────────────
import { QcChecklistPanel } from "../QcChecklistPanel";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = "case-qc-panel-001" as const;
const TIMESTAMP = 1_700_000_000_000;

type ItemStatus = "unchecked" | "ok" | "damaged" | "missing";

function makeItem(
  id: string,
  name: string,
  status: ItemStatus,
  extras?: Partial<{
    templateItemId: string;
    notes: string;
    checkedByName: string;
    checkedAt: number;
  }>
) {
  return {
    _id: id,
    _creationTime: TIMESTAMP,
    caseId: CASE_ID,
    templateItemId: extras?.templateItemId ?? `tpl-${id}`,
    name,
    status,
    notes: extras?.notes,
    checkedByName: extras?.checkedByName,
    checkedAt: extras?.checkedAt,
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: loading state
  mockUseChecklistByCase.mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Render states
// ─────────────────────────────────────────────────────────────────────────────

describe("QcChecklistPanel — render states", () => {
  it("renders loading skeleton when useChecklistByCase returns undefined", () => {
    mockUseChecklistByCase.mockReturnValue(undefined);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const loading = screen.getByTestId("qc-checklist-panel-loading");
    expect(loading).toBeTruthy();
  });

  it("loading element has aria-busy='true'", () => {
    mockUseChecklistByCase.mockReturnValue(undefined);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const el = document.querySelector("[aria-busy='true']");
    expect(el).not.toBeNull();
  });

  it("renders empty state when items array is empty", () => {
    mockUseChecklistByCase.mockReturnValue([]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const empty = screen.getByTestId("qc-checklist-panel-empty");
    expect(empty).toBeTruthy();
    expect(screen.getByText("No checklist items")).toBeTruthy();
  });

  it("renders item list section when items are present", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByTestId("qc-checklist-panel")).toBeTruthy();
    expect(screen.getByTestId("qc-checklist-item-list")).toBeTruthy();
  });

  it("passes the correct caseId to useChecklistByCase", () => {
    mockUseChecklistByCase.mockReturnValue([]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(mockUseChecklistByCase).toHaveBeenCalledWith(CASE_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Read-only contract
// ─────────────────────────────────────────────────────────────────────────────

describe("QcChecklistPanel — read-only contract", () => {
  beforeEach(() => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
      makeItem("i2", "Battery",    "unchecked"),
    ]);
  });

  it("renders no <button> elements (no interactive controls)", () => {
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const buttons = document.querySelectorAll("button");
    expect(buttons.length).toBe(0);
  });

  it("renders no <input> elements", () => {
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const inputs = document.querySelectorAll("input");
    expect(inputs.length).toBe(0);
  });

  it("renders no <select> elements", () => {
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const selects = document.querySelectorAll("select");
    expect(selects.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section header
// ─────────────────────────────────────────────────────────────────────────────

describe("QcChecklistPanel — section header", () => {
  it("renders 'QC Checklist' as the section title", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("QC Checklist")).toBeTruthy();
  });

  it("shows '1 item' for a single-item list", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("1 item")).toBeTruthy();
  });

  it("shows 'N items' for a multi-item list", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body",  "ok"),
      makeItem("i2", "Battery",     "damaged"),
      makeItem("i3", "Charger",     "unchecked"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("3 items")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary counts row
// ─────────────────────────────────────────────────────────────────────────────

describe("QcChecklistPanel — summary counts row", () => {
  it("shows pass count when ok items exist", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
      makeItem("i2", "Battery",    "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("2 pass")).toBeTruthy();
  });

  it("shows fail count when damaged items exist", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Battery", "damaged"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("1 fail")).toBeTruthy();
  });

  it("shows fail count for both damaged and missing items combined", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Battery",  "damaged"),
      makeItem("i2", "Charger",  "missing"),
      makeItem("i3", "Body",     "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("2 fail")).toBeTruthy();
  });

  it("shows needs-review count when unchecked items exist", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "unchecked"),
      makeItem("i2", "Battery",    "unchecked"),
      makeItem("i3", "Charger",    "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("2 needs review")).toBeTruthy();
  });

  it("does not show pass count when there are no ok items", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Battery", "damaged"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.queryByText(/\d+ pass/)).toBeNull();
  });

  it("does not show fail count when there are no damaged or missing items", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.queryByText(/\d+ fail/)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Status-to-StatusPill mapping
// ─────────────────────────────────────────────────────────────────────────────

describe("QcChecklistPanel — status-to-StatusPill mapping", () => {
  it("renders 'completed' StatusPill for ok items (pass)", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    expect(pills.some((p) => p.getAttribute("data-kind") === "completed")).toBe(true);
  });

  it("renders 'flagged' StatusPill for damaged items (fail)", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Battery", "damaged"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    expect(pills.some((p) => p.getAttribute("data-kind") === "flagged")).toBe(true);
  });

  it("renders 'exception' StatusPill for missing items (fail)", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Charger", "missing"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    expect(pills.some((p) => p.getAttribute("data-kind") === "exception")).toBe(true);
  });

  it("renders 'pending' StatusPill for unchecked items (needs-review)", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Landing Pad", "unchecked"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    expect(pills.some((p) => p.getAttribute("data-kind") === "pending")).toBe(true);
  });

  it("renders one StatusPill per item", () => {
    const items = [
      makeItem("i1", "Drone Body",     "ok"),
      makeItem("i2", "Battery Pack",   "damaged"),
      makeItem("i3", "Remote Control", "missing"),
      makeItem("i4", "Charger",        "unchecked"),
    ];
    mockUseChecklistByCase.mockReturnValue(items);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    expect(pills.length).toBe(4);
  });

  it("renders all four StatusKind variants in a mixed-status list", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Item OK",      "ok"),
      makeItem("i2", "Item Damaged", "damaged"),
      makeItem("i3", "Item Missing", "missing"),
      makeItem("i4", "Item Pending", "unchecked"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    const kinds = pills.map((p) => p.getAttribute("data-kind"));
    expect(kinds).toContain("completed");
    expect(kinds).toContain("flagged");
    expect(kinds).toContain("exception");
    expect(kinds).toContain("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item display
// ─────────────────────────────────────────────────────────────────────────────

describe("QcChecklistPanel — item display", () => {
  it("renders all item names from the checklist", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body",     "ok"),
      makeItem("i2", "Battery Pack",   "damaged"),
      makeItem("i3", "Remote Control", "missing"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("Drone Body")).toBeTruthy();
    expect(screen.getByText("Battery Pack")).toBeTruthy();
    expect(screen.getByText("Remote Control")).toBeTruthy();
  });

  it("each item has the correct data-status attribute", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
      makeItem("i2", "Battery",    "damaged"),
      makeItem("i3", "Charger",    "missing"),
      makeItem("i4", "Pad",        "unchecked"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const itemEls = screen.getAllByTestId("qc-checklist-item");
    const statuses = itemEls.map((el) => el.getAttribute("data-status"));
    expect(statuses).toContain("ok");
    expect(statuses).toContain("damaged");
    expect(statuses).toContain("missing");
    expect(statuses).toContain("unchecked");
  });

  it("item aria-label says 'Pass' for ok items", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const item = screen.getByTestId("qc-checklist-item");
    expect(item.getAttribute("aria-label")).toContain("Pass");
  });

  it("item aria-label says 'Fail – damaged' for damaged items", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Battery", "damaged"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const item = screen.getByTestId("qc-checklist-item");
    expect(item.getAttribute("aria-label")).toContain("Fail – damaged");
  });

  it("item aria-label says 'Fail – missing' for missing items", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Charger", "missing"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const item = screen.getByTestId("qc-checklist-item");
    expect(item.getAttribute("aria-label")).toContain("Fail – missing");
  });

  it("item aria-label says 'Needs review' for unchecked items", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Landing Pad", "unchecked"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const item = screen.getByTestId("qc-checklist-item");
    expect(item.getAttribute("aria-label")).toContain("Needs review");
  });

  it("item aria-label includes the item name", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    const item = screen.getByTestId("qc-checklist-item");
    expect(item.getAttribute("aria-label")).toContain("Drone Body");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Notes
// ─────────────────────────────────────────────────────────────────────────────

describe("QcChecklistPanel — notes", () => {
  it("renders item note text when present", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Battery", "damaged", {
        notes: "Minor scuff on corner, operational",
      }),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("Minor scuff on corner, operational")).toBeTruthy();
  });

  it("does not render note element when notes is absent", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    // No notes should be rendered — check there's no unexpected text
    expect(screen.queryByText(/scuff|note|comment/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Attribution
// ─────────────────────────────────────────────────────────────────────────────

describe("QcChecklistPanel — attribution", () => {
  it("renders attribution for ok items with checkedByName + checkedAt", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok", {
        checkedByName: "Alice Inspector",
        checkedAt: TIMESTAMP,
      }),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText(/Alice Inspector/)).toBeTruthy();
  });

  it("renders attribution for damaged items with checkedByName + checkedAt", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Battery", "damaged", {
        checkedByName: "Bob Tech",
        checkedAt: TIMESTAMP,
      }),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText(/Bob Tech/)).toBeTruthy();
  });

  it("renders attribution for missing items with checkedByName + checkedAt", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Charger", "missing", {
        checkedByName: "Carol Field",
        checkedAt: TIMESTAMP,
      }),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText(/Carol Field/)).toBeTruthy();
  });

  it("does NOT render attribution for unchecked items even when checkedByName is set", () => {
    // Edge case: checkedByName may be stale on an item that was reset to unchecked
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Landing Pad", "unchecked", {
        checkedByName: "Old Inspector",
        checkedAt: TIMESTAMP,
      }),
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    // Attribution should NOT be shown for unchecked items
    expect(screen.queryByText(/Old Inspector/)).toBeNull();
  });

  it("does not render attribution when checkedByName is absent", () => {
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
      // No checkedByName set
    ]);
    render(<QcChecklistPanel caseId={CASE_ID} />);
    // No timestamp text visible
    expect(screen.queryByText(/by /)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real-time subscription wiring
// ─────────────────────────────────────────────────────────────────────────────

describe("QcChecklistPanel — real-time subscription wiring", () => {
  it("re-renders correctly when subscription data changes (Convex push simulation)", () => {
    // Initial: two unchecked items
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body",  "unchecked"),
      makeItem("i2", "Battery Pack","unchecked"),
    ]);
    const { rerender } = render(<QcChecklistPanel caseId={CASE_ID} />);

    // Verify initial state: all items show as "needs review"
    let pills = screen.getAllByTestId("status-pill");
    expect(pills.every((p) => p.getAttribute("data-kind") === "pending")).toBe(true);
    expect(screen.getByText("2 needs review")).toBeTruthy();

    // Simulate Convex push: technician marked first item "ok"
    act(() => {
      mockUseChecklistByCase.mockReturnValue([
        makeItem("i1", "Drone Body",  "ok",        { checkedByName: "Alice", checkedAt: TIMESTAMP + 1000 }),
        makeItem("i2", "Battery Pack","unchecked"),
      ]);
    });
    rerender(<QcChecklistPanel caseId={CASE_ID} />);

    // StatusPill for first item now "completed"; second still "pending"
    pills = screen.getAllByTestId("status-pill");
    const completedPills = pills.filter((p) => p.getAttribute("data-kind") === "completed");
    const pendingPills   = pills.filter((p) => p.getAttribute("data-kind") === "pending");
    expect(completedPills.length).toBe(1);
    expect(pendingPills.length).toBe(1);
  });

  it("updates item count header when new items arrive via subscription push", () => {
    // Initial: one item
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body", "ok"),
    ]);
    const { rerender } = render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByText("1 item")).toBeTruthy();

    // Simulate subscription push: template applied, more items added
    act(() => {
      mockUseChecklistByCase.mockReturnValue([
        makeItem("i1", "Drone Body",   "ok"),
        makeItem("i2", "Battery Pack", "unchecked"),
        makeItem("i3", "Charger",      "unchecked"),
      ]);
    });
    rerender(<QcChecklistPanel caseId={CASE_ID} />);

    expect(screen.getByText("3 items")).toBeTruthy();
  });

  it("transitions from loading to populated when subscription resolves", () => {
    // Start in loading state
    mockUseChecklistByCase.mockReturnValue(undefined);
    const { rerender } = render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(screen.getByTestId("qc-checklist-panel-loading")).toBeTruthy();

    // Simulate subscription resolving with data
    act(() => {
      mockUseChecklistByCase.mockReturnValue([
        makeItem("i1", "Drone Body", "ok"),
      ]);
    });
    rerender(<QcChecklistPanel caseId={CASE_ID} />);

    // Loading skeleton gone; item list present
    expect(screen.queryByTestId("qc-checklist-panel-loading")).toBeNull();
    expect(screen.getByTestId("qc-checklist-panel")).toBeTruthy();
    expect(screen.getByText("Drone Body")).toBeTruthy();
  });

  it("uses different caseId when prop changes", () => {
    const CASE_ID_2 = "case-qc-panel-002";
    mockUseChecklistByCase.mockReturnValue([]);

    const { rerender } = render(<QcChecklistPanel caseId={CASE_ID} />);
    expect(mockUseChecklistByCase).toHaveBeenLastCalledWith(CASE_ID);

    rerender(<QcChecklistPanel caseId={CASE_ID_2} />);
    expect(mockUseChecklistByCase).toHaveBeenLastCalledWith(CASE_ID_2);
  });
});
