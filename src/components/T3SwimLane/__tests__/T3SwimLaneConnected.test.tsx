/**
 * src/components/T3SwimLane/__tests__/T3SwimLaneConnected.test.tsx
 *
 * Unit tests for T3SwimLaneConnected and its helper functions.
 *
 * Covers:
 *   • getSortKey    — returns mostRecentEventAt when present, falls back to updatedAt
 *   • toSwimLaneCase — maps SwimLaneCaseCard → SwimLaneCase correctly
 *     - id, label, status, location, assignee fields
 *     - hasDamage: true when currentPhase === "flagged"
 *     - hasDamage: true when a damage_reported event is present
 *     - hasDamage: undefined when neither condition holds
 *     - hasShipment: true when trackingNumber is present
 *     - hasShipment: undefined when trackingNumber is absent
 *   • flattenAndSort — flattens lanes and sorts by timestamp descending
 *     - empty board → empty array
 *     - cases from multiple lanes merged into one array
 *     - global sort by getSortKey() descending
 *     - per-column sort correctness after T3SwimLane re-partitions
 *   • T3SwimLaneConnected rendering
 *     - renders T3SwimLane in loading state when board is undefined
 *     - renders mapped cases when board is loaded
 *     - passes selectedCaseId and onSelectCase through to T3SwimLane
 *
 * These tests mock `useSwimLaneBoard` to avoid needing a live Convex instance.
 * The pure helper functions (getSortKey, toSwimLaneCase, flattenAndSort) are
 * tested directly without rendering — no mocking required for those.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  getSortKey,
  toSwimLaneCase,
  flattenAndSort,
  T3SwimLaneConnected,
} from "../T3SwimLaneConnected";
import type { SwimLaneCaseCard, SwimLaneBoardResult } from "@/hooks/use-swim-lane-board";
import type { SwimLaneBucket } from "@/hooks/use-swim-lane-board";

// ─── Mock useSwimLaneBoard ────────────────────────────────────────────────────

vi.mock("@/hooks/use-swim-lane-board", () => ({
  useSwimLaneBoard: vi.fn(),
}));

import { useSwimLaneBoard } from "@/hooks/use-swim-lane-board";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal SwimLaneCaseCard for testing.
 */
function makeCard(
  overrides: Partial<SwimLaneCaseCard> & { caseId: string; currentPhase: SwimLaneCaseCard["currentPhase"] }
): SwimLaneCaseCard {
  return {
    caseId:           overrides.caseId,
    label:            overrides.label          ?? `CASE-${overrides.caseId}`,
    currentPhase:     overrides.currentPhase,
    updatedAt:        overrides.updatedAt      ?? 1000,
    lat:              overrides.lat,
    lng:              overrides.lng,
    locationName:     overrides.locationName,
    assigneeId:       overrides.assigneeId,
    assigneeName:     overrides.assigneeName,
    missionId:        overrides.missionId,
    trackingNumber:   overrides.trackingNumber,
    phaseEvents:      overrides.phaseEvents    ?? [],
    mostRecentEventAt: overrides.mostRecentEventAt,
  };
}

/**
 * Build a minimal SwimLaneBoardResult lane for testing.
 */
function makeLane(
  phase: SwimLaneCaseCard["currentPhase"],
  cases: SwimLaneCaseCard[]
): SwimLaneBucket {
  return {
    phase,
    label:      phase,
    cases,
    caseCount:  cases.length,
    eventCount: 0,
  };
}

/**
 * Build a minimal SwimLaneBoardResult for testing.
 */
function makeBoard(lanes: SwimLaneBucket[]): SwimLaneBoardResult {
  const allCases = lanes.flatMap((l) => l.cases);
  return {
    lanes,
    totalCases:  allCases.length,
    totalEvents: 0,
    assembledAt: Date.now(),
  };
}

// ─── getSortKey ───────────────────────────────────────────────────────────────

describe("getSortKey", () => {
  it("returns mostRecentEventAt when present", () => {
    const card = makeCard({
      caseId:           "c1",
      currentPhase:     "deployed",
      updatedAt:        1000,
      mostRecentEventAt: 9999,
    });
    expect(getSortKey(card)).toBe(9999);
  });

  it("falls back to updatedAt when mostRecentEventAt is undefined", () => {
    const card = makeCard({
      caseId:       "c1",
      currentPhase: "hangar",
      updatedAt:    5000,
    });
    expect(getSortKey(card)).toBe(5000);
  });

  it("returns 0 for mostRecentEventAt when explicitly set to 0", () => {
    const card = makeCard({
      caseId:            "c1",
      currentPhase:      "hangar",
      updatedAt:         9999,
      mostRecentEventAt: 0,
    });
    // 0 is falsy — but we use ?? so undefined falls back, 0 does not
    expect(getSortKey(card)).toBe(0);
  });
});

// ─── toSwimLaneCase ───────────────────────────────────────────────────────────

describe("toSwimLaneCase", () => {
  it("maps id from caseId", () => {
    const card = makeCard({ caseId: "c-abc", currentPhase: "hangar" });
    const result = toSwimLaneCase(card);
    expect(result.id).toBe("c-abc");
  });

  it("maps label", () => {
    const card = makeCard({ caseId: "c1", currentPhase: "hangar", label: "CASE-001" });
    const result = toSwimLaneCase(card);
    expect(result.label).toBe("CASE-001");
  });

  it("maps status from currentPhase", () => {
    const card = makeCard({ caseId: "c1", currentPhase: "deployed" });
    const result = toSwimLaneCase(card);
    expect(result.status).toBe("deployed");
  });

  it("maps all 8 valid phases as status", () => {
    const phases: SwimLaneCaseCard["currentPhase"][] = [
      "hangar", "assembled", "transit_out", "deployed",
      "flagged", "recalled", "transit_in", "received", "archived",
    ];
    for (const phase of phases) {
      const card = makeCard({ caseId: "c1", currentPhase: phase });
      const result = toSwimLaneCase(card);
      expect(result.status).toBe(phase);
    }
  });

  it("maps location from locationName", () => {
    const card = makeCard({
      caseId:       "c1",
      currentPhase: "deployed",
      locationName: "Wind Farm North",
    });
    const result = toSwimLaneCase(card);
    expect(result.location).toBe("Wind Farm North");
  });

  it("maps assignee from assigneeName", () => {
    const card = makeCard({
      caseId:       "c1",
      currentPhase: "deployed",
      assigneeName: "Alice",
    });
    const result = toSwimLaneCase(card);
    expect(result.assignee).toBe("Alice");
  });

  it("location is undefined when locationName is absent", () => {
    const card = makeCard({ caseId: "c1", currentPhase: "hangar" });
    const result = toSwimLaneCase(card);
    expect(result.location).toBeUndefined();
  });

  it("assignee is undefined when assigneeName is absent", () => {
    const card = makeCard({ caseId: "c1", currentPhase: "hangar" });
    const result = toSwimLaneCase(card);
    expect(result.assignee).toBeUndefined();
  });

  // ── hasDamage ──────────────────────────────────────────────────────────────

  it("hasDamage is true when currentPhase === 'flagged'", () => {
    const card = makeCard({ caseId: "c1", currentPhase: "flagged" });
    const result = toSwimLaneCase(card);
    expect(result.hasDamage).toBe(true);
  });

  it("hasDamage is true when a damage_reported event is present", () => {
    const card = makeCard({
      caseId:       "c1",
      currentPhase: "deployed",
      phaseEvents: [
        {
          eventId:     "e1",
          eventType:   "damage_reported",
          timestamp:   2000,
          userId:      "user-1",
          userName:    "Alice",
          phase:       "deployed",
          isPhaseEntry: false,
          metadata:    { kind: "damage_reported" },
        },
      ],
    });
    const result = toSwimLaneCase(card);
    expect(result.hasDamage).toBe(true);
  });

  it("hasDamage is undefined when not flagged and no damage event", () => {
    const card = makeCard({
      caseId:       "c1",
      currentPhase: "deployed",
      phaseEvents: [
        {
          eventId:     "e1",
          eventType:   "inspection_started",
          timestamp:   2000,
          userId:      "user-1",
          userName:    "Alice",
          phase:       "deployed",
          isPhaseEntry: false,
          metadata:    { kind: "inspection", subKind: "started" },
        },
      ],
    });
    const result = toSwimLaneCase(card);
    expect(result.hasDamage).toBeUndefined();
  });

  it("hasDamage is true when flagged AND has damage_reported events", () => {
    const card = makeCard({
      caseId:       "c1",
      currentPhase: "flagged",
      phaseEvents: [
        {
          eventId:     "e1",
          eventType:   "damage_reported",
          timestamp:   2000,
          userId:      "user-1",
          userName:    "Alice",
          phase:       "flagged",
          isPhaseEntry: false,
          metadata:    { kind: "damage_reported" },
        },
      ],
    });
    const result = toSwimLaneCase(card);
    expect(result.hasDamage).toBe(true);
  });

  // ── hasShipment ────────────────────────────────────────────────────────────

  it("hasShipment is true when trackingNumber is present", () => {
    const card = makeCard({
      caseId:         "c1",
      currentPhase:   "transit_out",
      trackingNumber: "794644823741",
    });
    const result = toSwimLaneCase(card);
    expect(result.hasShipment).toBe(true);
  });

  it("hasShipment is undefined when trackingNumber is absent", () => {
    const card = makeCard({ caseId: "c1", currentPhase: "hangar" });
    const result = toSwimLaneCase(card);
    expect(result.hasShipment).toBeUndefined();
  });

  it("hasShipment is undefined when trackingNumber is empty string", () => {
    const card = makeCard({
      caseId:         "c1",
      currentPhase:   "transit_out",
      trackingNumber: "",
    });
    const result = toSwimLaneCase(card);
    // Boolean("") === false → mapped as undefined
    expect(result.hasShipment).toBeUndefined();
  });
});

// ─── flattenAndSort ───────────────────────────────────────────────────────────

describe("flattenAndSort", () => {
  it("returns an empty array when the board has no cases", () => {
    const board = makeBoard([
      makeLane("hangar",    []),
      makeLane("assembled", []),
      makeLane("deployed",  []),
    ]);
    const result = flattenAndSort(board);
    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });

  it("flattens cases from multiple lanes into a single array", () => {
    const board = makeBoard([
      makeLane("hangar",   [makeCard({ caseId: "c1", currentPhase: "hangar",   updatedAt: 1000 })]),
      makeLane("deployed", [makeCard({ caseId: "c2", currentPhase: "deployed", updatedAt: 2000 })]),
      makeLane("received", [makeCard({ caseId: "c3", currentPhase: "received", updatedAt: 3000 })]),
    ]);
    const result = flattenAndSort(board);
    expect(result).toHaveLength(3);
  });

  it("sorts cases by mostRecentEventAt descending (most recent first)", () => {
    const board = makeBoard([
      makeLane("deployed", [
        makeCard({ caseId: "c1", currentPhase: "deployed", updatedAt: 1000, mostRecentEventAt: 1000 }),
        makeCard({ caseId: "c2", currentPhase: "deployed", updatedAt: 2000, mostRecentEventAt: 9000 }),
        makeCard({ caseId: "c3", currentPhase: "deployed", updatedAt: 3000, mostRecentEventAt: 5000 }),
      ]),
    ]);
    const result = flattenAndSort(board);
    expect(result[0].id).toBe("c2"); // mostRecentEventAt: 9000
    expect(result[1].id).toBe("c3"); // mostRecentEventAt: 5000
    expect(result[2].id).toBe("c1"); // mostRecentEventAt: 1000
  });

  it("uses updatedAt as fallback when mostRecentEventAt is absent", () => {
    const board = makeBoard([
      makeLane("hangar", [
        makeCard({ caseId: "c1", currentPhase: "hangar", updatedAt: 1000 }),
        makeCard({ caseId: "c2", currentPhase: "hangar", updatedAt: 8000 }),
        makeCard({ caseId: "c3", currentPhase: "hangar", updatedAt: 4000 }),
      ]),
    ]);
    const result = flattenAndSort(board);
    expect(result[0].id).toBe("c2"); // updatedAt: 8000
    expect(result[1].id).toBe("c3"); // updatedAt: 4000
    expect(result[2].id).toBe("c1"); // updatedAt: 1000
  });

  it("merges cases from different phases and sorts globally by timestamp", () => {
    // Hangar case is more recent than a deployed case
    const board = makeBoard([
      makeLane("hangar",   [makeCard({ caseId: "c1", currentPhase: "hangar",   updatedAt: 5000 })]),
      makeLane("deployed", [makeCard({ caseId: "c2", currentPhase: "deployed", updatedAt: 3000 })]),
    ]);
    const result = flattenAndSort(board);
    // c1 (5000) should come before c2 (3000) in the sorted flat array
    expect(result[0].id).toBe("c1");
    expect(result[1].id).toBe("c2");
  });

  it("preserves per-column sort when T3SwimLane re-partitions by status", () => {
    // Two cases in the same column (hangar) with different timestamps
    const board = makeBoard([
      makeLane("hangar", [
        makeCard({ caseId: "c1", currentPhase: "hangar", updatedAt: 1000 }),
        makeCard({ caseId: "c2", currentPhase: "hangar", updatedAt: 9000 }),
      ]),
    ]);
    // flattenAndSort produces c2 first (9000 > 1000)
    const result = flattenAndSort(board);
    expect(result[0].id).toBe("c2");
    expect(result[1].id).toBe("c1");
    // When T3SwimLane re-partitions, both land in the "hangar" column with c2 first
    expect(result[0].status).toBe("hangar");
    expect(result[1].status).toBe("hangar");
  });

  it("handles mixed phases: global sort puts most-recent case first regardless of phase", () => {
    // assembled case (updatedAt: 7000) beats hangar case (updatedAt: 2000)
    const board = makeBoard([
      makeLane("hangar",   [makeCard({ caseId: "c-old", currentPhase: "hangar",   updatedAt: 2000 })]),
      makeLane("assembled",[makeCard({ caseId: "c-new", currentPhase: "assembled", updatedAt: 7000 })]),
    ]);
    const result = flattenAndSort(board);
    // c-new (7000) before c-old (2000)
    expect(result[0].id).toBe("c-new");
    expect(result[1].id).toBe("c-old");
    // Both land in the "hangar" column of T3SwimLane (status: "assembled" → hangar column)
    // and the c-new card is first within that column
    expect(result[0].status).toBe("assembled");
    expect(result[1].status).toBe("hangar");
  });

  it("handles an empty board with no lanes gracefully", () => {
    const board = makeBoard([]);
    const result = flattenAndSort(board);
    expect(result).toHaveLength(0);
  });

  it("maps all cards through toSwimLaneCase", () => {
    const board = makeBoard([
      makeLane("transit_out", [
        makeCard({
          caseId:         "c1",
          currentPhase:   "transit_out",
          label:          "CASE-001",
          locationName:   "HQ",
          assigneeName:   "Bob",
          trackingNumber: "123456",
        }),
      ]),
    ]);
    const result = flattenAndSort(board);
    expect(result[0].id).toBe("c1");
    expect(result[0].label).toBe("CASE-001");
    expect(result[0].status).toBe("transit_out");
    expect(result[0].location).toBe("HQ");
    expect(result[0].assignee).toBe("Bob");
    expect(result[0].hasShipment).toBe(true);
  });
});

// ─── T3SwimLaneConnected rendering ───────────────────────────────────────────

describe("T3SwimLaneConnected — rendering", () => {
  it("renders loading skeletons when board is undefined (initial load)", () => {
    // Mock hook to return undefined (loading)
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    render(<T3SwimLaneConnected />);

    // In loading state, count badges show "…"
    const badge = screen.getByTestId("swim-lane-col-count-hangar");
    expect(badge.textContent).toBe("…");
  });

  it("renders all four columns while loading", () => {
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    render(<T3SwimLaneConnected />);

    expect(screen.getByTestId("swim-lane-column-hangar")).toBeTruthy();
    expect(screen.getByTestId("swim-lane-column-carrier")).toBeTruthy();
    expect(screen.getByTestId("swim-lane-column-field")).toBeTruthy();
    expect(screen.getByTestId("swim-lane-column-returning")).toBeTruthy();
  });

  it("renders mapped case cards when board has data", () => {
    const board = makeBoard([
      makeLane("hangar", [
        makeCard({ caseId: "c1", currentPhase: "hangar", label: "CASE-001" }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected />);

    const card = screen.getByTestId("swim-lane-card-c1");
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("CASE-001");
  });

  it("distributes deployed case to the Field column", () => {
    const board = makeBoard([
      makeLane("deployed", [
        makeCard({ caseId: "c1", currentPhase: "deployed", label: "CS-FIELD" }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected />);

    const card = screen.getByTestId("swim-lane-card-c1");
    const fieldColumn = screen.getByTestId("swim-lane-column-field");
    expect(fieldColumn.contains(card)).toBe(true);
  });

  it("distributes transit_out case to the Carrier column", () => {
    const board = makeBoard([
      makeLane("transit_out", [
        makeCard({ caseId: "c1", currentPhase: "transit_out", label: "CS-CARRIER" }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected />);

    const card = screen.getByTestId("swim-lane-card-c1");
    const carrierColumn = screen.getByTestId("swim-lane-column-carrier");
    expect(carrierColumn.contains(card)).toBe(true);
  });

  it("distributes received case to the Returning column", () => {
    const board = makeBoard([
      makeLane("received", [
        makeCard({ caseId: "c1", currentPhase: "received", label: "CS-RETURN" }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected />);

    const card = screen.getByTestId("swim-lane-card-c1");
    const returningColumn = screen.getByTestId("swim-lane-column-returning");
    expect(returningColumn.contains(card)).toBe(true);
  });

  it("distributes assembled case to the Hangar column", () => {
    const board = makeBoard([
      makeLane("assembled", [
        makeCard({ caseId: "c1", currentPhase: "assembled", label: "CS-ASSEMBLED" }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected />);

    const card = screen.getByTestId("swim-lane-card-c1");
    const hangarColumn = screen.getByTestId("swim-lane-column-hangar");
    expect(hangarColumn.contains(card)).toBe(true);
  });

  it("shows correct count when multiple cases are in a column", () => {
    const board = makeBoard([
      makeLane("hangar", [
        makeCard({ caseId: "c1", currentPhase: "hangar" }),
        makeCard({ caseId: "c2", currentPhase: "hangar" }),
      ]),
      makeLane("assembled", [
        makeCard({ caseId: "c3", currentPhase: "assembled" }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected />);

    // Hangar column gets hangar (2) + assembled (1) = 3
    const badge = screen.getByTestId("swim-lane-col-count-hangar");
    expect(badge.textContent?.trim()).toBe("3");
  });

  it("shows empty state in columns with no cases", () => {
    const board = makeBoard([
      makeLane("deployed", [
        makeCard({ caseId: "c1", currentPhase: "deployed" }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected />);

    // Carrier column should be empty (no transit_out cases)
    const carrierList = screen.getByTestId("swim-lane-col-list-carrier");
    expect(carrierList.textContent).toContain("No cases in transit");
  });

  it("passes selectedCaseId prop through to T3SwimLane", () => {
    const board = makeBoard([
      makeLane("deployed", [
        makeCard({ caseId: "c1", currentPhase: "deployed" }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(
      <T3SwimLaneConnected
        selectedCaseId="c1"
        onSelectCase={() => undefined}
      />
    );

    const card = screen.getByTestId("swim-lane-card-c1");
    expect(card.getAttribute("aria-selected")).toBe("true");
  });

  it("renders cards sorted by timestamp within the same column", () => {
    // c2 is more recent, should appear before c1 within the field column
    const board = makeBoard([
      makeLane("deployed", [
        makeCard({ caseId: "c1", currentPhase: "deployed", updatedAt: 1000 }),
        makeCard({ caseId: "c2", currentPhase: "deployed", updatedAt: 9000 }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected onSelectCase={() => undefined} />);

    const fieldList = screen.getByTestId("swim-lane-col-list-field");
    const cards = fieldList.querySelectorAll("[data-testid^='swim-lane-card-']");
    // c2 should come before c1
    expect(cards[0].getAttribute("data-testid")).toBe("swim-lane-card-c2");
    expect(cards[1].getAttribute("data-testid")).toBe("swim-lane-card-c1");
  });

  it("handles an empty board result without errors", () => {
    const board = makeBoard([
      makeLane("hangar",     []),
      makeLane("assembled",  []),
      makeLane("transit_out",[]),
      makeLane("deployed",   []),
      makeLane("flagged",    []),
      makeLane("transit_in", []),
      makeLane("received",   []),
      makeLane("archived",   []),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected />);

    // Should render all 4 columns with empty states
    expect(screen.getByText("No cases in hangar")).toBeTruthy();
    expect(screen.getByText("No cases in transit")).toBeTruthy();
    expect(screen.getByText("No cases deployed")).toBeTruthy();
    expect(screen.getByText("No cases returning")).toBeTruthy();
  });

  it("renders the flagged case with the damage indicator", () => {
    const board = makeBoard([
      makeLane("flagged", [
        makeCard({ caseId: "c1", currentPhase: "flagged", label: "CS-FLAGGED" }),
      ]),
    ]);
    (useSwimLaneBoard as ReturnType<typeof vi.fn>).mockReturnValue(board);

    render(<T3SwimLaneConnected />);

    const card = screen.getByTestId("swim-lane-card-c1");
    expect(card.textContent).toContain("Flagged");
  });
});
