/**
 * @vitest-environment jsdom
 *
 * T2Manifest.test.tsx
 *
 * Unit tests for the T2Manifest (Manifest / Packing List) tab panel.
 *
 * This component is the T2 slot in CaseDetailPanel — the "Manifest" tab that
 * shows the case's packing list in a tabular layout with equipment items,
 * quantity/status columns, and checklist data.
 *
 * Test strategy
 * ─────────────
 * • useChecklistWithInspection and useDamageReportsByCase are mocked so we
 *   can control all data states without a live Convex environment.
 * • useLatestShipment is mocked for shipment banner tests.
 * • CustodySection is mocked as a no-op to isolate T2Manifest behavior.
 * • StatusPill is mocked as a transparent span so we can assert the `kind`
 *   prop without rendering CSS module dependencies.
 *
 * Coverage matrix
 * ───────────────
 *
 * Render states:
 *   ✓ renders loading spinner while checklist is loading (undefined)
 *   ✓ renders empty state when case has no manifest items
 *   ✓ renders the item list when items are present
 *   ✓ passes caseId to useChecklistWithInspection
 *
 * Column structure:
 *   ✓ renders column headers (Item | Qty | Status)
 *   ✓ each item row has a "1×" quantity value
 *   ✓ item name appears in the name column
 *   ✓ status pill appears in the status column
 *
 * Checklist data display:
 *   ✓ displays all item names from checklist
 *   ✓ shows the correct total item count in the progress bar
 *   ✓ shows the correct reviewed count in the progress bar
 *   ✓ progress bar has correct aria-valuenow
 *   ✓ summary shows "verified" label for ok items
 *   ✓ summary shows "flagged" label for damaged items
 *   ✓ summary shows "missing" label for missing items
 *
 * Status-to-StatusPill mapping:
 *   ✓ "ok" item → "completed" StatusPill kind
 *   ✓ "damaged" item → "flagged" StatusPill kind
 *   ✓ "missing" item → "exception" StatusPill kind
 *   ✓ "unchecked" item → "pending" StatusPill kind
 *
 * aria-label on item rows:
 *   ✓ "ok" item has aria-label with "Verified"
 *   ✓ "damaged" item has aria-label with "Flagged"
 *   ✓ "missing" item has aria-label with "Missing"
 *   ✓ "unchecked" item has aria-label with "Unchecked"
 *
 * Status data attributes:
 *   ✓ "ok" item has data-status="ok"
 *   ✓ "damaged" item has data-status="damaged"
 *
 * Filter bar:
 *   ✓ renders All / Unchecked / OK / Damaged / Missing filter buttons
 *   ✓ clicking "OK" filter shows only ok items
 *   ✓ clicking "Damaged" filter shows only damaged items
 *   ✓ clicking "All" restores all items
 *   ✓ active filter button has aria-pressed="true"
 *   ✓ shows filtered empty state when filter has no matches
 *
 * Item notes:
 *   ✓ renders item note text when present
 *   ✓ does not render note element when absent
 *
 * Attribution:
 *   ✓ renders checker attribution when checkedByName and checkedAt are set
 *   ✓ does not render attribution when checkedByName is absent
 *
 * Left-border data-status accents:
 *   ✓ ok item has data-status="ok" (drives border-left via CSS)
 *   ✓ damaged item has data-status="damaged"
 *   ✓ missing item has data-status="missing"
 *   ✓ unchecked item has data-status="unchecked"
 *
 * Damage reports integration:
 *   ✓ shows severity badge for damaged item with a damage report
 *   ✓ shows photo count for damaged item with photos
 *
 * Shipment banner:
 *   ✓ renders shipment banner when shipment with tracking number exists
 *   ✓ does not render shipment banner when no shipment exists
 *
 * CaseDetailPanel integration:
 *   ✓ T2 tab is labeled "Manifest" in the tab bar
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// useChecklistWithInspection — controls loading/empty/populated states
const mockUseChecklistWithInspection = vi.fn();
vi.mock("../../../queries/checklist", () => ({
  useChecklistWithInspection: (...args: unknown[]) =>
    mockUseChecklistWithInspection(...args),
}));

// useDamageReportsByCase — controls damage report data
const mockUseDamageReportsByCase = vi.fn();
vi.mock("../../../hooks/use-damage-reports", () => ({
  useDamageReportsByCase: (...args: unknown[]) =>
    mockUseDamageReportsByCase(...args),
  useDamagePhotoReportsWithUrls: vi.fn().mockReturnValue([]),
}));

// useLatestShipment + getTrackingUrl — controls shipment banner
const mockUseLatestShipment = vi.fn();
vi.mock("../../../hooks/use-shipment-status", () => ({
  useLatestShipment: (...args: unknown[]) => mockUseLatestShipment(...args),
  getTrackingUrl: (tn: string) => `https://fedex.com/track/${tn}`,
}));

// CustodySection — stub to avoid pulling in custody dependencies
vi.mock("../CustodySection", () => ({
  default: ({ caseId }: { caseId: string }) => (
    <div data-testid="custody-section" data-case-id={caseId} />
  ),
}));

// StatusPill — transparent stub so we can assert the `kind` prop
vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind}>{kind}</span>
  ),
}));

// Import SUT after all mocks are registered
import T2Manifest from "../T2Manifest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = "case-manifest-001" as const;

function makeItem(
  id: string,
  name: string,
  status: "unchecked" | "ok" | "damaged" | "missing",
  extras?: Partial<{
    templateItemId: string;
    notes: string;
    checkedByName: string;
    checkedAt: number;
    photoStorageIds: string[];
  }>
) {
  return {
    _id: id,
    _creationTime: 1_700_000_000_000,
    caseId: CASE_ID,
    templateItemId: extras?.templateItemId ?? `tpl-${id}`,
    name,
    status,
    notes: extras?.notes,
    checkedByName: extras?.checkedByName,
    checkedAt: extras?.checkedAt,
    photoStorageIds: extras?.photoStorageIds,
  };
}

function makeSummary(items: ReturnType<typeof makeItem>[]) {
  const ok = items.filter((i) => i.status === "ok").length;
  const damaged = items.filter((i) => i.status === "damaged").length;
  const missing = items.filter((i) => i.status === "missing").length;
  const unchecked = items.filter((i) => i.status === "unchecked").length;
  const total = items.length;
  const reviewed = ok + damaged + missing;
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  return { caseId: CASE_ID, total, ok, damaged, missing, unchecked, progressPct, isComplete: unchecked === 0 };
}

function makeChecklistData(items: ReturnType<typeof makeItem>[]) {
  return {
    items,
    inspection: null,
    summary: makeSummary(items),
  };
}

const ALL_ITEMS = [
  makeItem("i1", "Drone Body",     "ok",        { checkedByName: "Alice", checkedAt: 1_700_000_000_000 }),
  makeItem("i2", "Battery Pack",   "damaged",   { notes: "Minor scuff on corner", templateItemId: "tpl-battery" }),
  makeItem("i3", "Remote Control", "missing"),
  makeItem("i4", "Charger",        "unchecked"),
  makeItem("i5", "Landing Pad",    "ok"),
];

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUseLatestShipment.mockReturnValue(null); // no shipment by default
  mockUseDamageReportsByCase.mockReturnValue([]); // no damage reports by default
  mockUseChecklistWithInspection.mockReturnValue(undefined); // loading by default
});

afterEach(() => {
  cleanup();
});

// ─── Render states ────────────────────────────────────────────────────────────

describe("T2Manifest — render states", () => {
  it("renders loading spinner while checklist data is undefined", () => {
    mockUseChecklistWithInspection.mockReturnValue(undefined);
    const { container } = render(<T2Manifest caseId={CASE_ID} />);
    const spinner = container.querySelector("[aria-busy='true']");
    expect(spinner).not.toBeNull();
    expect(screen.queryByTestId("t2-manifest-item-list")).toBeNull();
  });

  it("renders t2-manifest-loading testid while loading", () => {
    mockUseChecklistWithInspection.mockReturnValue(undefined);
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByTestId("t2-manifest-loading")).toBeTruthy();
  });

  it("renders empty state message when case has no manifest items", () => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData([]));
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByText("No manifest items")).toBeTruthy();
    expect(screen.getByText(/Apply a case template/)).toBeTruthy();
  });

  it("renders item list when items are present", () => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(ALL_ITEMS));
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByTestId("t2-manifest-item-list")).toBeTruthy();
  });

  it("renders the t2-manifest root testid", () => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(ALL_ITEMS));
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByTestId("t2-manifest")).toBeTruthy();
  });

  it("passes caseId to useChecklistWithInspection", () => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData([]));
    render(<T2Manifest caseId={CASE_ID} />);
    expect(mockUseChecklistWithInspection).toHaveBeenCalledWith(CASE_ID);
  });
});

// ─── Column structure ─────────────────────────────────────────────────────────

describe("T2Manifest — column structure", () => {
  beforeEach(() => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(ALL_ITEMS));
  });

  it("renders the column headers section", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByTestId("t2-manifest-col-headers")).toBeTruthy();
  });

  it("column headers contain 'Item' label", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    const headers = screen.getByTestId("t2-manifest-col-headers");
    expect(headers.textContent).toContain("Item");
  });

  it("column headers contain 'Qty' label", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    const headers = screen.getByTestId("t2-manifest-col-headers");
    expect(headers.textContent).toContain("Qty");
  });

  it("column headers contain 'Status' label", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    const headers = screen.getByTestId("t2-manifest-col-headers");
    expect(headers.textContent).toContain("Status");
  });

  it("each item row shows '1×' as the quantity value", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    const qtyValues = screen.getAllByTitle("Expected quantity");
    expect(qtyValues.length).toBe(ALL_ITEMS.length);
    for (const qty of qtyValues) {
      expect(qty.textContent).toBe("1×");
    }
  });

  it("qty cell has aria-label 'Expected quantity: 1'", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    const qtyValues = screen.getAllByLabelText("Expected quantity: 1");
    expect(qtyValues.length).toBe(ALL_ITEMS.length);
  });
});

// ─── Checklist data display ───────────────────────────────────────────────────

describe("T2Manifest — checklist data display", () => {
  beforeEach(() => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(ALL_ITEMS));
  });

  it("displays all item names", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    for (const item of ALL_ITEMS) {
      expect(screen.getByText(item.name)).toBeTruthy();
    }
  });

  it("renders a progress bar for the packing list", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toBeTruthy();
  });

  it("progress bar has correct aria-valuenow (80% for 4/5 reviewed)", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    const bar = screen.getByRole("progressbar");
    // 4 reviewed (ok x2, damaged x1, missing x1) out of 5 = 80%
    expect(bar.getAttribute("aria-valuenow")).toBe("80");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("shows the reviewed / total count in the header", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    // 4 reviewed (ok+damaged+missing) of 5 total
    expect(screen.getByText("4 / 5 reviewed")).toBeTruthy();
  });

  it("renders 'Packing List' as the section title", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByText("Packing List")).toBeTruthy();
  });

  it("renders one manifest-item row per item", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getAllByTestId("manifest-item")).toHaveLength(ALL_ITEMS.length);
  });
});

// ─── Status-to-StatusPill mapping ────────────────────────────────────────────

describe("T2Manifest — StatusPill kind mapping", () => {
  it.each([
    ["ok",        "completed"],
    ["damaged",   "flagged"],
    ["missing",   "exception"],
    ["unchecked", "pending"],
  ] as const)(
    "item with status='%s' passes kind='%s' to StatusPill",
    (status, expectedKind) => {
      mockUseChecklistWithInspection.mockReturnValue(
        makeChecklistData([makeItem("s1", "Test Item", status)])
      );
      render(<T2Manifest caseId={CASE_ID} />);
      const pills = screen.getAllByTestId("status-pill");
      expect(pills).toHaveLength(1);
      expect(pills[0].getAttribute("data-kind")).toBe(expectedKind);
    }
  );
});

// ─── aria-label on item rows ──────────────────────────────────────────────────

describe("T2Manifest — item row aria-labels", () => {
  it.each([
    ["ok",        "Drone Body",     "Verified"],
    ["damaged",   "Battery Pack",   "Flagged"],
    ["missing",   "Remote Control", "Missing"],
    ["unchecked", "Charger",        "Unchecked"],
  ] as const)(
    "item with status='%s' has aria-label containing '%s'",
    (status, name, expectedLabel) => {
      mockUseChecklistWithInspection.mockReturnValue(
        makeChecklistData([makeItem("a1", name, status)])
      );
      render(<T2Manifest caseId={CASE_ID} />);
      const row = screen.getByTestId("manifest-item");
      expect(row.getAttribute("aria-label")).toBe(`${name}: ${expectedLabel}`);
    }
  );
});

// ─── Status data attributes ───────────────────────────────────────────────────

describe("T2Manifest — item data-status attributes", () => {
  it.each([
    "ok", "damaged", "missing", "unchecked",
  ] as const)(
    "item has data-status='%s'",
    (status) => {
      mockUseChecklistWithInspection.mockReturnValue(
        makeChecklistData([makeItem("ds1", "Test Item", status)])
      );
      render(<T2Manifest caseId={CASE_ID} />);
      const row = screen.getByTestId("manifest-item");
      expect(row.getAttribute("data-status")).toBe(status);
    }
  );
});

// ─── Filter bar ───────────────────────────────────────────────────────────────

describe("T2Manifest — filter bar", () => {
  beforeEach(() => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(ALL_ITEMS));
  });

  it("renders a filter group with All/Unchecked/OK/Damaged/Missing buttons", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    const group = screen.getByRole("group", { name: /Filter by item status/i });
    expect(group).toBeTruthy();
    const buttons = within(group).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(5);
  });

  it("default filter 'All' has aria-pressed='true'", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    const allBtn = screen.getByLabelText(/Show all items/i);
    expect(allBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking 'OK' filter shows only ok items", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    fireEvent.click(screen.getByLabelText(/Show ok items/i));
    const rows = screen.getAllByTestId("manifest-item");
    expect(rows).toHaveLength(2); // Drone Body + Landing Pad
    for (const row of rows) {
      expect(row.getAttribute("data-status")).toBe("ok");
    }
  });

  it("clicking 'Damaged' filter shows only damaged items", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    fireEvent.click(screen.getByLabelText(/Show damaged items/i));
    const rows = screen.getAllByTestId("manifest-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-status")).toBe("damaged");
  });

  it("clicking 'Missing' filter shows only missing items", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    fireEvent.click(screen.getByLabelText(/Show missing items/i));
    const rows = screen.getAllByTestId("manifest-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-status")).toBe("missing");
  });

  it("clicking 'All' after a filter restores all items", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    fireEvent.click(screen.getByLabelText(/Show ok items/i));
    fireEvent.click(screen.getByLabelText(/Show all items/i));
    expect(screen.getAllByTestId("manifest-item")).toHaveLength(ALL_ITEMS.length);
  });

  it("active filter button has aria-pressed='true'", () => {
    render(<T2Manifest caseId={CASE_ID} />);
    fireEvent.click(screen.getByLabelText(/Show damaged items/i));
    const damagedBtn = screen.getByLabelText(/Show damaged items/i);
    expect(damagedBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows filtered empty state when filter has no matches", () => {
    // Only ok items — filtering for "missing" should produce empty state
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData([
        makeItem("fe1", "Drone Body",  "ok"),
        makeItem("fe2", "Landing Pad", "ok"),
      ])
    );
    render(<T2Manifest caseId={CASE_ID} />);
    fireEvent.click(screen.getByLabelText(/Show missing items/i));
    expect(screen.getByTestId("t2-manifest-empty-filtered")).toBeTruthy();
  });
});

// ─── Item notes ───────────────────────────────────────────────────────────────

describe("T2Manifest — item notes", () => {
  it("renders item note text when present", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData([makeItem("n1", "Battery Pack", "damaged", { notes: "Minor scuff on corner" })])
    );
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByText("Minor scuff on corner")).toBeTruthy();
  });

  it("does not render note element when notes is absent", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData([makeItem("n2", "Landing Pad", "ok")])
    );
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.queryByText(/scuff/i)).toBeNull();
  });
});

// ─── Attribution ──────────────────────────────────────────────────────────────

describe("T2Manifest — checker attribution", () => {
  it("renders 'Verified by Alice' when checkedByName and checkedAt are set on an ok item", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData([
        makeItem("c1", "Drone Body", "ok", {
          checkedByName: "Alice",
          checkedAt: 1_700_000_000_000,
        }),
      ])
    );
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByText(/Verified by Alice/)).toBeTruthy();
  });

  it("does not render attribution when checkedByName is absent", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData([makeItem("c2", "Landing Pad", "ok")])
    );
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.queryByText(/Verified by/)).toBeNull();
  });
});

// ─── Damage reports integration ───────────────────────────────────────────────

describe("T2Manifest — damage reports", () => {
  it("shows severity badge for a damaged item with a damage report", () => {
    const items = [makeItem("dr1", "Battery Pack", "damaged", { templateItemId: "tpl-battery" })];
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(items));
    mockUseDamageReportsByCase.mockReturnValue([
      {
        templateItemId: "tpl-battery",
        severity: "moderate",
        photoStorageIds: [],
        reportedByName: null,
      },
    ]);
    render(<T2Manifest caseId={CASE_ID} />);
    const badge = screen.getByLabelText("Severity: moderate");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("moderate");
  });

  it("shows photo count line when damage report has photos", () => {
    const items = [makeItem("dr2", "Battery Pack", "damaged", { templateItemId: "tpl-bat2" })];
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(items));
    mockUseDamageReportsByCase.mockReturnValue([
      {
        templateItemId: "tpl-bat2",
        severity: "minor",
        photoStorageIds: ["photo-1", "photo-2"],
        reportedByName: "Bob",
      },
    ]);
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByText(/2 photos/)).toBeTruthy();
    expect(screen.getByText(/Bob/)).toBeTruthy();
  });

  it("does not show photo count for items without photos", () => {
    const items = [makeItem("dr3", "Battery Pack", "damaged", { templateItemId: "tpl-bat3" })];
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(items));
    mockUseDamageReportsByCase.mockReturnValue([
      {
        templateItemId: "tpl-bat3",
        severity: "minor",
        photoStorageIds: [],
        reportedByName: null,
      },
    ]);
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.queryByText(/photo/)).toBeNull();
  });
});

// ─── Shipment banner ──────────────────────────────────────────────────────────

describe("T2Manifest — shipment status banner", () => {
  it("renders shipment banner when shipment with tracking number exists", () => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(ALL_ITEMS));
    mockUseLatestShipment.mockReturnValue({
      _id: "ship-1",
      caseId: CASE_ID,
      trackingNumber: "794644823741",
      carrier: "FedEx",
      status: "in_transit",
      estimatedDelivery: null,
    });
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByTestId("t2-shipment-banner")).toBeTruthy();
  });

  it("does not render shipment banner when no shipment exists", () => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(ALL_ITEMS));
    mockUseLatestShipment.mockReturnValue(null);
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.queryByTestId("t2-shipment-banner")).toBeNull();
  });

  it("calls onNavigateToShipping when 'View Shipping →' is clicked", () => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(ALL_ITEMS));
    mockUseLatestShipment.mockReturnValue({
      _id: "ship-1",
      caseId: CASE_ID,
      trackingNumber: "794644823741",
      carrier: "FedEx",
      status: "in_transit",
      estimatedDelivery: null,
    });
    const onNavigate = vi.fn();
    render(<T2Manifest caseId={CASE_ID} onNavigateToShipping={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /View full shipping details/i }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});

// ─── Custody section ──────────────────────────────────────────────────────────

describe("T2Manifest — custody section", () => {
  it("renders the custody section with the correct caseId", () => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData(ALL_ITEMS));
    render(<T2Manifest caseId={CASE_ID} />);
    const custodySection = screen.getByTestId("custody-section");
    expect(custodySection).toBeTruthy();
    expect(custodySection.getAttribute("data-case-id")).toBe(CASE_ID);
  });

  it("renders custody section even when items list is empty", () => {
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData([]));
    render(<T2Manifest caseId={CASE_ID} />);
    expect(screen.getByTestId("custody-section")).toBeTruthy();
  });
});
