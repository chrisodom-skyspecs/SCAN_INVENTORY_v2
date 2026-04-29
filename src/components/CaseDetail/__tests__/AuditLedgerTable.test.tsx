/**
 * @vitest-environment jsdom
 *
 * AuditLedgerTable.test.tsx
 *
 * Unit tests for the T5 Audit Ledger sortable table component.
 * src/components/CaseDetail/AuditLedgerTable.tsx
 *
 * Coverage matrix
 * ───────────────
 *
 * Render states:
 *   ✓ renders empty state when rows is empty
 *   ✓ renders table when rows are present
 *   ✓ renders correct number of rows
 *   ✓ data-testid passthrough works
 *
 * Column headers:
 *   ✓ renders all five column headers (timestamp, actor, action, case ID, hash)
 *   ✓ hides hash column when ffEnabled=false
 *   ✓ shows hash column when ffEnabled=true (default)
 *   ✓ each header has a sort button
 *   ✓ sort button has aria-label
 *   ✓ default active column is timestamp (descending)
 *   ✓ active column has aria-sort="descending" initially
 *   ✓ inactive columns have aria-sort="none"
 *
 * Sort state management:
 *   ✓ clicking timestamp header toggles to ascending
 *   ✓ clicking timestamp header a second time toggles back to descending
 *   ✓ clicking a different column sets it as active with ascending direction
 *   ✓ clicking actor header — aria-sort becomes "ascending"
 *   ✓ clicking actor header again — aria-sort becomes "descending"
 *   ✓ switching columns resets direction to ascending
 *
 * Sort ordering:
 *   ✓ rows are sorted by timestamp descending by default
 *   ✓ clicking timestamp once → ascending → oldest row first
 *   ✓ sorting by actor alphabetically ascending
 *   ✓ sorting by actor alphabetically descending
 *   ✓ sorting by action ascending
 *   ✓ sorting by caseId ascending
 *   ✓ sorting by hash ascending (rows with no hash sort last)
 *
 * Cell content:
 *   ✓ timestamp cell contains a <time> element with ISO dateTime
 *   ✓ actor cell shows the actor name
 *   ✓ action cell shows the action label
 *   ✓ caseId cell shows the case ID
 *   ✓ hash cell shows truncated hash when hash is present
 *   ✓ hash cell shows "—" when hash is absent
 *   ✓ full hash available in title attribute
 *
 * Footer:
 *   ✓ row count badge shows correct count
 *   ✓ row count uses singular "event" for 1 row
 *   ✓ row count uses plural "events" for multiple rows
 *
 * Accessibility:
 *   ✓ table has aria-label
 *   ✓ scroll region has role="region" and aria-label
 *   ✓ sort button aria-label describes column and current direction
 *   ✓ <time> dateTime attribute is valid ISO 8601
 *   ✓ Case ID code element has aria-label
 *   ✓ hash code element has aria-label
 *
 * initialSort prop:
 *   ✓ initialSort can override default to actor ascending
 *
 * No data fetching:
 *   ✓ component renders without any Convex provider
 *   ✓ component renders without any mock setup beyond props
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import AuditLedgerTable from "../AuditLedgerTable";
import type { AuditLedgerRow } from "../AuditLedgerTable";

// ─── Test setup ───────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_TS = 1_700_000_000_000; // Nov 14, 2023

function makeRow(overrides: Partial<AuditLedgerRow> = {}): AuditLedgerRow {
  return {
    id:        "row-001",
    timestamp: BASE_TS,
    actor:     "Alice Tech",
    action:    "Status Changed",
    caseId:    "case-abc-123",
    hash:      "aabbccdd11223344556677889900aabbccdd1122",
    ...overrides,
  };
}

// Three rows with distinct values for sort verification
const THREE_ROWS: AuditLedgerRow[] = [
  makeRow({
    id:        "row-a",
    timestamp: BASE_TS + 2000,
    actor:     "Charlie Ops",
    action:    "Shipped",
    caseId:    "case-zzz",
    hash:      "aaaa1111",
  }),
  makeRow({
    id:        "row-b",
    timestamp: BASE_TS + 1000,
    actor:     "Alice Tech",
    action:    "Damage Reported",
    caseId:    "case-mmm",
    hash:      "bbbb2222",
  }),
  makeRow({
    id:        "row-c",
    timestamp: BASE_TS,
    actor:     "Bob Pilot",
    action:    "Custody Handoff",
    caseId:    "case-aaa",
    hash:      undefined,
  }),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return all ledger-row elements from the rendered table. */
function getLedgerRows() {
  return screen.getAllByTestId("ledger-row");
}

/** Return the cell by testId within a specific row element. */
function getCellIn(row: HTMLElement, testId: string) {
  return within(row).getByTestId(testId);
}

// ─── Render states ────────────────────────────────────────────────────────────

describe("render states", () => {
  it("renders the empty state when rows is empty", () => {
    render(<AuditLedgerTable rows={[]} />);
    expect(screen.getByTestId("ledger-empty")).toBeDefined();
  });

  it("does not render the table when rows is empty", () => {
    render(<AuditLedgerTable rows={[]} />);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the table when rows are present", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    expect(screen.getByRole("table")).toBeDefined();
  });

  it("renders the correct number of body rows", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    expect(getLedgerRows()).toHaveLength(3);
  });

  it("accepts a custom data-testid", () => {
    render(<AuditLedgerTable rows={[]} data-testid="my-ledger" />);
    expect(screen.getByTestId("my-ledger")).toBeDefined();
  });

  it("renders without a Convex provider (no data fetching)", () => {
    // If the component tried to fetch data, this would throw.
    expect(() =>
      render(<AuditLedgerTable rows={[makeRow()]} />)
    ).not.toThrow();
  });
});

// ─── Column headers ───────────────────────────────────────────────────────────

describe("column headers", () => {
  it("renders the Timestamp column header", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const btn = screen.getByTestId("sort-timestamp");
    expect(btn).toBeDefined();
    expect(btn.textContent).toContain("Timestamp");
  });

  it("renders the Actor column header", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    expect(screen.getByTestId("sort-actor").textContent).toContain("Actor");
  });

  it("renders the Action column header", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    expect(screen.getByTestId("sort-action").textContent).toContain("Action");
  });

  it("renders the Case ID column header", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    expect(screen.getByTestId("sort-caseId").textContent).toContain("Case ID");
  });

  it("renders the Hash column header when ffEnabled=true (default)", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    expect(screen.getByTestId("sort-hash")).toBeDefined();
  });

  it("hides the Hash column header when ffEnabled=false", () => {
    render(<AuditLedgerTable rows={[makeRow()]} ffEnabled={false} />);
    expect(screen.queryByTestId("sort-hash")).toBeNull();
  });

  it("hides the hash data cells when ffEnabled=false", () => {
    render(<AuditLedgerTable rows={[makeRow()]} ffEnabled={false} />);
    expect(screen.queryByTestId("cell-hash")).toBeNull();
    expect(screen.queryByTestId("cell-hash-empty")).toBeNull();
  });
});

// ─── Default sort state ───────────────────────────────────────────────────────

describe("default sort state (timestamp descending)", () => {
  it("timestamp column has aria-sort='descending' by default", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const th = screen.getByTestId("sort-timestamp").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("descending");
  });

  it("actor column has aria-sort='none' by default", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const th = screen.getByTestId("sort-actor").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("none");
  });

  it("action column has aria-sort='none' by default", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const th = screen.getByTestId("sort-action").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("none");
  });

  it("caseId column has aria-sort='none' by default", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const th = screen.getByTestId("sort-caseId").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("none");
  });

  it("hash column has aria-sort='none' by default", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const th = screen.getByTestId("sort-hash").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("none");
  });

  it("table has data-sort-column='timestamp' by default", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const table = screen.getByRole("table");
    expect(table.getAttribute("data-sort-column")).toBe("timestamp");
  });

  it("table has data-sort-direction='desc' by default", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const table = screen.getByRole("table");
    expect(table.getAttribute("data-sort-direction")).toBe("desc");
  });
});

// ─── Sort state transitions ───────────────────────────────────────────────────

describe("sort state transitions", () => {
  it("clicking active column (timestamp) toggles to ascending", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    fireEvent.click(screen.getByTestId("sort-timestamp"));
    const th = screen.getByTestId("sort-timestamp").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("ascending");
  });

  it("clicking active column again toggles back to descending", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    // Click once → asc
    fireEvent.click(screen.getByTestId("sort-timestamp"));
    // Click again → desc
    fireEvent.click(screen.getByTestId("sort-timestamp"));
    const th = screen.getByTestId("sort-timestamp").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("descending");
  });

  it("clicking a different column (actor) makes it the active sort", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    fireEvent.click(screen.getByTestId("sort-actor"));
    const actorTh = screen.getByTestId("sort-actor").closest("th");
    expect(actorTh?.getAttribute("aria-sort")).toBe("ascending");
    // timestamp should become "none"
    const tsTh = screen.getByTestId("sort-timestamp").closest("th");
    expect(tsTh?.getAttribute("aria-sort")).toBe("none");
  });

  it("switching to actor then clicking again → descending", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    fireEvent.click(screen.getByTestId("sort-actor"));
    fireEvent.click(screen.getByTestId("sort-actor"));
    const th = screen.getByTestId("sort-actor").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("descending");
  });

  it("switching columns resets direction to ascending", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    // Click timestamp (now descending) then switch to action
    fireEvent.click(screen.getByTestId("sort-action"));
    const actionTh = screen.getByTestId("sort-action").closest("th");
    expect(actionTh?.getAttribute("aria-sort")).toBe("ascending");
  });

  it("clicking caseId column makes it active ascending", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    fireEvent.click(screen.getByTestId("sort-caseId"));
    const th = screen.getByTestId("sort-caseId").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("ascending");
  });

  it("clicking hash column makes it active ascending", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    fireEvent.click(screen.getByTestId("sort-hash"));
    const th = screen.getByTestId("sort-hash").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("ascending");
  });
});

// ─── Sort ordering ────────────────────────────────────────────────────────────

describe("sort ordering", () => {
  /** Get actor names from rendered rows in DOM order */
  function getActorNames() {
    return getLedgerRows().map((row) =>
      getCellIn(row, "cell-actor").textContent
    );
  }

  /** Get caseId from rendered rows in DOM order */
  function getCaseIds() {
    return getLedgerRows().map((row) =>
      getCellIn(row, "cell-case-id").textContent
    );
  }

  it("rows sorted timestamp descending by default (newest first)", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    const rows = getLedgerRows();
    // row-a has BASE_TS+2000 (newest), row-b BASE_TS+1000, row-c BASE_TS
    expect(rows[0].getAttribute("data-row-id")).toBe("row-a");
    expect(rows[1].getAttribute("data-row-id")).toBe("row-b");
    expect(rows[2].getAttribute("data-row-id")).toBe("row-c");
  });

  it("clicking timestamp → ascending puts oldest row first", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId("sort-timestamp"));
    const rows = getLedgerRows();
    expect(rows[0].getAttribute("data-row-id")).toBe("row-c"); // BASE_TS (oldest)
    expect(rows[2].getAttribute("data-row-id")).toBe("row-a"); // newest
  });

  it("sorting by actor ascending: Alice → Bob → Charlie", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId("sort-actor"));
    expect(getActorNames()).toEqual(["Alice Tech", "Bob Pilot", "Charlie Ops"]);
  });

  it("sorting by actor descending: Charlie → Bob → Alice", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId("sort-actor"));
    fireEvent.click(screen.getByTestId("sort-actor"));
    expect(getActorNames()).toEqual(["Charlie Ops", "Bob Pilot", "Alice Tech"]);
  });

  it("sorting by action ascending: Custody Handoff → Damage Reported → Shipped", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId("sort-action"));
    const actions = getLedgerRows().map((r) =>
      getCellIn(r, "cell-action").textContent
    );
    expect(actions).toEqual(["Custody Handoff", "Damage Reported", "Shipped"]);
  });

  it("sorting by caseId ascending: case-aaa → case-mmm → case-zzz", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId("sort-caseId"));
    expect(getCaseIds()).toEqual(["case-aaa", "case-mmm", "case-zzz"]);
  });

  it("sorting by caseId descending: case-zzz → case-mmm → case-aaa", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId("sort-caseId"));
    fireEvent.click(screen.getByTestId("sort-caseId"));
    expect(getCaseIds()).toEqual(["case-zzz", "case-mmm", "case-aaa"]);
  });

  it("sorting by hash ascending: empty hash (row-c) sorts first", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId("sort-hash"));
    // empty string ("") < "aaaa1111" < "bbbb2222"
    const rows = getLedgerRows();
    expect(rows[0].getAttribute("data-row-id")).toBe("row-c"); // hash: undefined → ""
    expect(rows[1].getAttribute("data-row-id")).toBe("row-a"); // hash: "aaaa1111"
    expect(rows[2].getAttribute("data-row-id")).toBe("row-b"); // hash: "bbbb2222"
  });
});

// ─── Cell content ─────────────────────────────────────────────────────────────

describe("cell content", () => {
  it("timestamp cell contains a <time> element", () => {
    const { container } = render(<AuditLedgerTable rows={[makeRow()]} />);
    const timeEl = container.querySelector("time");
    expect(timeEl).not.toBeNull();
  });

  it("<time> has a valid ISO 8601 dateTime attribute", () => {
    const { container } = render(<AuditLedgerTable rows={[makeRow({ timestamp: BASE_TS })]} />);
    const timeEl = container.querySelector("time");
    const dt = timeEl?.getAttribute("dateTime") ?? "";
    expect(() => new Date(dt)).not.toThrow();
    expect(new Date(dt).getTime()).toBe(BASE_TS);
  });

  it("actor cell shows the actor name", () => {
    render(<AuditLedgerTable rows={[makeRow({ actor: "Alice Tech" })]} />);
    expect(screen.getByTestId("cell-actor").textContent).toBe("Alice Tech");
  });

  it("action cell shows the action label", () => {
    render(<AuditLedgerTable rows={[makeRow({ action: "Shipped" })]} />);
    expect(screen.getByTestId("cell-action").textContent).toBe("Shipped");
  });

  it("caseId cell shows the full case ID", () => {
    render(<AuditLedgerTable rows={[makeRow({ caseId: "case-xyz-789" })]} />);
    expect(screen.getByTestId("cell-case-id").textContent).toBe("case-xyz-789");
  });

  it("hash cell shows a truncated hash prefix", () => {
    const hash = "aabbccdd11223344556677889900";
    render(<AuditLedgerTable rows={[makeRow({ hash })]} />);
    const cell = screen.getByTestId("cell-hash");
    // Should show first 12 chars + ellipsis
    expect(cell.textContent).toContain("aabbccdd1122");
    expect(cell.textContent).toContain("…");
  });

  it("hash cell has title attribute with the full hash", () => {
    const hash = "aabbccdd11223344556677889900";
    render(<AuditLedgerTable rows={[makeRow({ hash })]} />);
    const cell = screen.getByTestId("cell-hash");
    expect(cell.getAttribute("title")).toBe(hash);
  });

  it("hash cell shows '—' when hash is undefined", () => {
    render(<AuditLedgerTable rows={[makeRow({ hash: undefined })]} />);
    expect(screen.getByTestId("cell-hash-empty").textContent).toBe("—");
  });
});

// ─── Footer ───────────────────────────────────────────────────────────────────

describe("footer", () => {
  it("shows '1 event' (singular) for a single row", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    expect(screen.getByTestId("ledger-row-count").textContent).toBe("1 event");
  });

  it("shows '3 events' (plural) for three rows", () => {
    render(<AuditLedgerTable rows={THREE_ROWS} />);
    expect(screen.getByTestId("ledger-row-count").textContent).toBe("3 events");
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("accessibility", () => {
  it("table has aria-label='Audit event ledger'", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const table = screen.getByRole("table");
    expect(table.getAttribute("aria-label")).toBe("Audit event ledger");
  });

  it("scroll region has role='region' and aria-label", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const region = screen.getByRole("region", { name: /audit event ledger/i });
    expect(region).toBeDefined();
  });

  it("sort button aria-label includes the column name", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    const btn = screen.getByTestId("sort-actor");
    expect(btn.getAttribute("aria-label")).toMatch(/actor/i);
  });

  it("sort button for the active column includes current direction", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    // timestamp is active descending by default
    const btn = screen.getByTestId("sort-timestamp");
    expect(btn.getAttribute("aria-label")).toMatch(/descending/i);
  });

  it("sort button for the active column reflects ascending after one click", () => {
    render(<AuditLedgerTable rows={[makeRow()]} />);
    fireEvent.click(screen.getByTestId("sort-timestamp"));
    const btn = screen.getByTestId("sort-timestamp");
    expect(btn.getAttribute("aria-label")).toMatch(/ascending/i);
  });

  it("caseId cell has aria-label starting with 'Case ID:'", () => {
    render(<AuditLedgerTable rows={[makeRow({ caseId: "case-abc-123" })]} />);
    const cell = screen.getByTestId("cell-case-id");
    expect(cell.getAttribute("aria-label")).toContain("Case ID");
  });

  it("hash cell has aria-label when hash is present", () => {
    const hash = "deadbeef1234";
    render(<AuditLedgerTable rows={[makeRow({ hash })]} />);
    const cell = screen.getByTestId("cell-hash");
    expect(cell.getAttribute("aria-label")).toContain("SHA-256");
  });

  it("empty hash cell has aria-label='No hash'", () => {
    render(<AuditLedgerTable rows={[makeRow({ hash: undefined })]} />);
    const cell = screen.getByTestId("cell-hash-empty");
    expect(cell.getAttribute("aria-label")).toBe("No hash");
  });
});

// ─── initialSort prop ──────────────────────────────────────────────────────────

describe("initialSort prop", () => {
  it("can initialise sort to actor ascending", () => {
    render(
      <AuditLedgerTable
        rows={THREE_ROWS}
        initialSort={{ column: "actor", direction: "asc" }}
      />
    );
    const actorTh = screen.getByTestId("sort-actor").closest("th");
    expect(actorTh?.getAttribute("aria-sort")).toBe("ascending");
    // Verify rows sorted correctly on initial render
    const names = getLedgerRows().map((r) =>
      getCellIn(r, "cell-actor").textContent
    );
    expect(names).toEqual(["Alice Tech", "Bob Pilot", "Charlie Ops"]);
  });

  it("can initialise sort to caseId descending", () => {
    render(
      <AuditLedgerTable
        rows={THREE_ROWS}
        initialSort={{ column: "caseId", direction: "desc" }}
      />
    );
    const th = screen.getByTestId("sort-caseId").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("descending");
    const ids = getLedgerRows().map((r) =>
      getCellIn(r, "cell-case-id").textContent
    );
    expect(ids).toEqual(["case-zzz", "case-mmm", "case-aaa"]);
  });
});
