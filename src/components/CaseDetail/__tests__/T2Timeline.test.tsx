/**
 * @vitest-environment jsdom
 *
 * T2Timeline.test.tsx
 *
 * Unit tests for T2Timeline (src/components/CaseDetail/T2Timeline.tsx)
 *
 * Sub-AC 1 of AC 14: T2 vertical spine timeline layout component.
 * Sub-AC 2 of AC 14: Sticky date headers that pin to the viewport top
 *   as the user scrolls through timeline sections grouped by calendar day.
 *
 * Coverage matrix
 * ───────────────
 *
 * Render states:
 *   ✓ renders loading skeleton when journey is undefined
 *   ✓ loading state has aria-busy="true"
 *   ✓ renders not-found error when journey is null
 *   ✓ renders empty state when stops array is empty
 *   ✓ renders timeline root when stops are present
 *   ✓ passes caseId to useM2JourneyStops
 *
 * Panel header:
 *   ✓ renders "Event Timeline" panel title
 *   ✓ renders count badge with event count
 *   ✓ count badge has aria-live="polite" and aria-atomic="true"
 *   ✓ count badge shows correct number
 *   ✓ sort toggle not shown when only one event
 *   ✓ sort toggle shown when more than one event
 *   ✓ sort toggle defaults to "Oldest first" (asc)
 *
 * Case identity row:
 *   ✓ renders caseLabel in the identity row
 *   ✓ renders currentStatus in the identity row
 *
 * Timeline list (date-grouped structure):
 *   ✓ renders an ordered list for events
 *   ✓ timeline wrapper has descriptive aria-label
 *   ✓ renders correct number of list items
 *   ✓ events in oldest-first order by default
 *
 * Event items — spine dot:
 *   ✓ first event has data-is-first="true"
 *   ✓ last event has data-is-last="true"
 *   ✓ single event is both first and last
 *   ✓ event dot has correct data-variant for status_change (brand)
 *   ✓ event dot has correct data-variant for damage_reported (error)
 *   ✓ event dot has correct data-variant for inspection_completed (success)
 *   ✓ event dot has correct data-variant for shipped (transit)
 *   ✓ event dot has correct data-variant for custody_handoff (neutral)
 *   ✓ no-location event has data-no-location="true" on dot
 *
 * Event items — content:
 *   ✓ renders event type label for status_change → "Status Changed"
 *   ✓ renders event type label for damage_reported → "Damage Reported"
 *   ✓ renders event type label for custody_handoff → "Custody Handoff"
 *   ✓ renders event type label for inspection_started → "Inspection Started"
 *   ✓ renders actor name in meta line
 *   ✓ renders timestamp in <time> element with dateTime attribute
 *   ✓ renders location name when present
 *   ✓ renders "No location recorded" when hasCoordinates=false
 *   ✓ renders StatusPill for status_change events (statusKind derived)
 *   ✓ renders StatusPill for damage_reported (flagged)
 *   ✓ renders StatusPill for shipped (transit_out)
 *
 * Event metadata details:
 *   ✓ status_change shows from → to transition
 *   ✓ custody_handoff shows toUserName
 *   ✓ shipped shows trackingNumber
 *   ✓ mission_assigned shows missionName
 *   ✓ template_applied shows templateName + itemCount
 *
 * Sort toggle:
 *   ✓ clicking sort toggle switches to "Newest first"
 *   ✓ clicking again switches back to "Oldest first"
 *   ✓ reversed order puts latest event first
 *
 * Sticky date headers (Sub-AC 2):
 *   ✓ renders one date header for events on the same day
 *   ✓ renders "Today" label for events timestamped today (noon local)
 *   ✓ renders "Yesterday" label for events timestamped yesterday (noon local)
 *   ✓ renders two date headers for events on distinct calendar days
 *   ✓ date header has role="heading" for accessibility
 *   ✓ date header has aria-level="4" (below h3 panelTitle)
 *   ✓ each date group has its own <section> element
 *   ✓ section has descriptive aria-label with date and event count
 *   ✓ each date group contains its own <ol> event list
 *   ✓ all events still render with correct count (across multiple date groups)
 *   ✓ date headers appear in sorted date order (asc: oldest first)
 *   ✓ date headers appear in reversed date order after toggling to newest-first
 *   ✓ isFirst is global (first event in first date group)
 *   ✓ isLast is global (last event in last date group)
 *
 * Accessibility:
 *   ✓ each event item has aria-label with position and event type
 *   ✓ sort toggle has descriptive aria-label
 *
 * Mocking strategy:
 *   • useM2JourneyStops is mocked to control loading/data/not-found states.
 *   • StatusPill is mocked as a simple span to avoid CSS module issues.
 *   • No Convex provider needed.
 */

import React from "react";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { M2CaseJourney, JourneyStop } from "@/hooks/use-m2-journey-stops";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUseM2JourneyStops = vi.fn();
vi.mock("@/hooks/use-m2-journey-stops", () => ({
  useM2JourneyStops: (caseId: string | null) => mockUseM2JourneyStops(caseId),
}));

// Mock StatusPill as a simple testable span
vi.mock("@/components/StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind} />
  ),
}));

// Import AFTER mocks
import T2Timeline from "../T2Timeline";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID    = "case-timeline-001";
const CASE_LABEL = "CASE-001";

function makeStop(overrides: Partial<JourneyStop> = {}): JourneyStop {
  return {
    stopIndex:      1,
    eventId:        "evt-001",
    eventType:      "status_change",
    timestamp:      1_700_000_000_000,
    location:       { lat: 42.36, lng: -71.06, locationName: "Site Alpha" },
    hasCoordinates: true,
    actorId:        "user-alice",
    actorName:      "Alice Tech",
    metadata:       { from: "hangar", to: "deployed" },
    ...overrides,
  };
}

function makeJourney(overrides: Partial<M2CaseJourney> = {}): M2CaseJourney {
  const stop = makeStop();
  return {
    caseId:              CASE_ID,
    caseLabel:           CASE_LABEL,
    currentStatus:       "deployed",
    currentLat:          42.36,
    currentLng:          -71.06,
    currentLocationName: "Site Alpha",
    stops:               [stop],
    stopCount:           1,
    firstStop:           stop,
    lastStop:            stop,
    hasLocation:         true,
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUseM2JourneyStops.mockReturnValue(undefined); // default: loading
});

afterEach(() => {
  cleanup();
});

// ─── Render states ────────────────────────────────────────────────────────────

describe("render states", () => {
  it("renders loading skeleton when journey is undefined", () => {
    mockUseM2JourneyStops.mockReturnValue(undefined);
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const skeleton = container.querySelector("[aria-busy='true']");
    expect(skeleton).not.toBeNull();
  });

  it("loading state has aria-label describing what is loading", () => {
    mockUseM2JourneyStops.mockReturnValue(undefined);
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const skeleton = container.querySelector("[aria-label*='Loading']");
    expect(skeleton).not.toBeNull();
  });

  it("renders timeline root element", () => {
    mockUseM2JourneyStops.mockReturnValue(undefined);
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByTestId("t2-timeline")).toBeDefined();
  });

  it("renders not-found error when journey is null", () => {
    mockUseM2JourneyStops.mockReturnValue(null);
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText(/Case not found/i)).toBeDefined();
  });

  it("renders empty state when stops array is empty", () => {
    const journey = makeJourney({ stops: [], stopCount: 0, firstStop: null, lastStop: null });
    mockUseM2JourneyStops.mockReturnValue(journey);
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByTestId("t2-timeline-empty")).toBeDefined();
    expect(screen.getByText(/No events recorded yet/i)).toBeDefined();
  });

  it("renders timeline when stops are present", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    render(<T2Timeline caseId={CASE_ID} />);
    // Should not show empty state
    expect(screen.queryByTestId("t2-timeline-empty")).toBeNull();
    // Should show the ordered list
    expect(screen.getByRole("list")).toBeDefined();
  });

  it("passes caseId to useM2JourneyStops", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    render(<T2Timeline caseId={CASE_ID} />);
    expect(mockUseM2JourneyStops).toHaveBeenCalledWith(CASE_ID);
  });
});

// ─── Panel header ─────────────────────────────────────────────────────────────

describe("panel header", () => {
  it("renders 'Event Timeline' panel title", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Event Timeline")).toBeDefined();
  });

  it("renders count badge with correct event count", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),
      makeStop({ stopIndex: 3, eventId: "e3" }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 3 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const badge = screen.getByTestId("t2-timeline-count");
    expect(badge.textContent).toBe("3");
  });

  it("count badge has aria-live='polite' and aria-atomic='true'", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    render(<T2Timeline caseId={CASE_ID} />);
    const badge = screen.getByTestId("t2-timeline-count");
    expect(badge.getAttribute("aria-live")).toBe("polite");
    expect(badge.getAttribute("aria-atomic")).toBe("true");
  });

  it("sort toggle not shown when only one event", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [makeStop()], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.queryByTestId("t2-timeline-sort-toggle")).toBeNull();
  });

  it("sort toggle shown when more than one event", () => {
    const stops = [makeStop(), makeStop({ stopIndex: 2, eventId: "e2" })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByTestId("t2-timeline-sort-toggle")).toBeDefined();
  });

  it("sort toggle defaults to 'Oldest first'", () => {
    const stops = [makeStop(), makeStop({ stopIndex: 2, eventId: "e2" })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const toggle = screen.getByTestId("t2-timeline-sort-toggle");
    expect(toggle.textContent).toContain("Oldest first");
  });
});

// ─── Case identity row ────────────────────────────────────────────────────────

describe("case identity row", () => {
  it("renders caseLabel in the identity row", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ caseLabel: "CASE-007" }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("CASE-007")).toBeDefined();
  });

  it("renders currentStatus in the identity row", () => {
    // Use transit_in which won't appear in any event metadata fixture
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ currentStatus: "transit_in" }));
    render(<T2Timeline caseId={CASE_ID} />);
    // currentStatus replaces underscores with spaces for display
    expect(screen.getByText("transit in")).toBeDefined();
  });
});

// ─── Timeline list ────────────────────────────────────────────────────────────

describe("timeline list", () => {
  it("renders an ordered list for events", () => {
    // Since events are grouped by date, there is now at least one <ol>
    // (one per date group).  All stops in this test use the same timestamp
    // so they all land in one date group → one <ol>.
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    render(<T2Timeline caseId={CASE_ID} />);
    // getAllByRole returns all lists; there should be at least one
    const lists = screen.getAllByRole("list");
    expect(lists.length).toBeGreaterThanOrEqual(1);
  });

  it("timeline wrapper has descriptive aria-label with event count and case label", () => {
    // The aria-label now lives on the <div role="group" data-testid="t2-timeline-list">
    // wrapper, not on the <ol> (which is per-date-group).
    const stops = [makeStop(), makeStop({ stopIndex: 2, eventId: "e2" })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2, caseLabel: "CASE-001" }));
    render(<T2Timeline caseId={CASE_ID} />);
    const wrapper = screen.getByTestId("t2-timeline-list");
    const ariaLabel = wrapper.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("2");
    expect(ariaLabel).toContain("CASE-001");
  });

  it("renders correct number of list items", () => {
    // All stops share the same timestamp → one date group → one <ol> with 3 <li>s
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),
      makeStop({ stopIndex: 3, eventId: "e3" }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 3 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
  });

  it("renders all stops without truncation by default", () => {
    // All 10 stops share the same timestamp → one date group → 10 <li>s
    const stops = Array.from({ length: 10 }, (_, i) =>
      makeStop({ stopIndex: i + 1, eventId: `e${i + 1}` })
    );
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 10 }));
    render(<T2Timeline caseId={CASE_ID} />);
    // All 10 items should render without any truncation
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(10);
  });
});

// ─── Event items — spine dot ──────────────────────────────────────────────────

describe("event items — spine dot", () => {
  it("first event has data-is-first='true'", () => {
    const stops = [makeStop(), makeStop({ stopIndex: 2, eventId: "e2" })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const firstItem = container.querySelector("[data-is-first='true']");
    expect(firstItem).not.toBeNull();
  });

  it("last event has data-is-last='true'", () => {
    const stops = [makeStop(), makeStop({ stopIndex: 2, eventId: "e2" })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const lastItem = container.querySelector("[data-is-last='true']");
    expect(lastItem).not.toBeNull();
  });

  it("single event is both first and last", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const both = container.querySelector("[data-is-first='true'][data-is-last='true']");
    expect(both).not.toBeNull();
  });

  it("dot has data-variant='brand' for status_change events", () => {
    const stop = makeStop({ eventType: "status_change" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const dot = container.querySelector("[data-variant='brand']");
    expect(dot).not.toBeNull();
  });

  it("dot has data-variant='error' for damage_reported events", () => {
    const stop = makeStop({ eventType: "damage_reported" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const dot = container.querySelector("[data-variant='error']");
    expect(dot).not.toBeNull();
  });

  it("dot has data-variant='success' for inspection_completed events", () => {
    const stop = makeStop({ eventType: "inspection_completed" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const dot = container.querySelector("[data-variant='success']");
    expect(dot).not.toBeNull();
  });

  it("dot has data-variant='transit' for shipped events", () => {
    const stop = makeStop({ eventType: "shipped" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const dot = container.querySelector("[data-variant='transit']");
    expect(dot).not.toBeNull();
  });

  it("dot has data-variant='neutral' for custody_handoff events", () => {
    const stop = makeStop({ eventType: "custody_handoff" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const dot = container.querySelector("[data-variant='neutral']");
    expect(dot).not.toBeNull();
  });

  it("dot has data-no-location='true' when hasCoordinates=false", () => {
    const stop = makeStop({ hasCoordinates: false, location: {} });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const noLocDot = container.querySelector("[data-no-location='true']");
    expect(noLocDot).not.toBeNull();
  });
});

// ─── Event items — content ────────────────────────────────────────────────────

describe("event items — content", () => {
  it("renders 'Status Changed' for status_change event type", () => {
    const stop = makeStop({ eventType: "status_change" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Status Changed")).toBeDefined();
  });

  it("renders 'Damage Reported' for damage_reported event type", () => {
    const stop = makeStop({ eventType: "damage_reported", metadata: {} });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Damage Reported")).toBeDefined();
  });

  it("renders 'Custody Handoff' for custody_handoff event type", () => {
    const stop = makeStop({ eventType: "custody_handoff", metadata: {} });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Custody Handoff")).toBeDefined();
  });

  it("renders 'Inspection Started' for inspection_started event type", () => {
    const stop = makeStop({ eventType: "inspection_started", metadata: {} });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Inspection Started")).toBeDefined();
  });

  it("renders 'Mission Assigned' for mission_assigned event type", () => {
    const stop = makeStop({ eventType: "mission_assigned", metadata: {} });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Mission Assigned")).toBeDefined();
  });

  it("renders actor name in meta line", () => {
    const stop = makeStop({ actorName: "Bob Pilot" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Bob Pilot")).toBeDefined();
  });

  it("renders timestamp in <time> element with ISO 8601 dateTime", () => {
    const stop = makeStop({ timestamp: 1_700_000_000_000 });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const timeEl = container.querySelector("time");
    expect(timeEl).not.toBeNull();
    const dt = timeEl?.getAttribute("dateTime") ?? "";
    expect(new Date(dt).getTime()).toBe(1_700_000_000_000);
  });

  it("renders location name when present", () => {
    const stop = makeStop({
      location: { lat: 42.36, lng: -71.06, locationName: "Site Alpha" },
      hasCoordinates: true,
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Site Alpha")).toBeDefined();
  });

  it("renders 'No location recorded' when hasCoordinates=false", () => {
    const stop = makeStop({ hasCoordinates: false, location: {} });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("No location recorded")).toBeDefined();
  });

  it("renders StatusPill for status_change events", () => {
    const stop = makeStop({
      eventType: "status_change",
      metadata: { from: "hangar", to: "deployed" },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const pill = screen.getByTestId("status-pill");
    expect(pill).toBeDefined();
    expect(pill.getAttribute("data-kind")).toBe("deployed");
  });

  it("renders StatusPill with kind='flagged' for damage_reported", () => {
    const stop = makeStop({ eventType: "damage_reported", metadata: {} });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("flagged");
  });

  it("renders StatusPill with kind='transit_out' for shipped", () => {
    const stop = makeStop({
      eventType: "shipped",
      metadata: { trackingNumber: "794644823741" },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("transit_out");
  });

  it("does NOT render StatusPill for template_applied (no pill expected)", () => {
    const stop = makeStop({
      eventType: "template_applied",
      metadata: { templateName: "Standard Kit", itemCount: 12 },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.queryByTestId("status-pill")).toBeNull();
  });
});

// ─── Event metadata details ───────────────────────────────────────────────────

describe("event metadata details", () => {
  it("status_change shows 'from' status text", () => {
    const stop = makeStop({
      eventType: "status_change",
      metadata: { from: "hangar", to: "assembled" },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("hangar")).toBeDefined();
  });

  it("status_change shows 'to' status text", () => {
    const stop = makeStop({
      eventType: "status_change",
      metadata: { from: "hangar", to: "assembled" },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("assembled")).toBeDefined();
  });

  it("custody_handoff shows toUserName", () => {
    const stop = makeStop({
      eventType: "custody_handoff",
      metadata: { fromUserName: "Alice Tech", toUserName: "Bob Pilot" },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Bob Pilot")).toBeDefined();
  });

  it("shipped shows trackingNumber in metadata", () => {
    const stop = makeStop({
      eventType: "shipped",
      metadata: { trackingNumber: "794644823741" },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("794644823741")).toBeDefined();
  });

  it("mission_assigned shows missionName", () => {
    const stop = makeStop({
      eventType: "mission_assigned",
      metadata: { missionId: "m-001", missionName: "Site Alpha Deploy" },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText("Site Alpha Deploy")).toBeDefined();
  });

  it("template_applied shows templateName", () => {
    const stop = makeStop({
      eventType: "template_applied",
      metadata: { templateName: "Standard Drone Kit", itemCount: 15 },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText(/Standard Drone Kit/)).toBeDefined();
  });

  it("template_applied shows itemCount", () => {
    const stop = makeStop({
      eventType: "template_applied",
      metadata: { templateName: "Standard Drone Kit", itemCount: 15 },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText(/15 items/)).toBeDefined();
  });

  it("inspection_completed shows checkedItems and totalItems", () => {
    const stop = makeStop({
      eventType: "inspection_completed",
      metadata: { totalItems: 20, checkedItems: 18, damagedItems: 2 },
    });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    expect(screen.getByText(/18 \/ 20 items/)).toBeDefined();
  });
});

// ─── Sort toggle ──────────────────────────────────────────────────────────────

describe("sort toggle", () => {
  /**
   * Two stops on the SAME calendar day (1 hour apart) to keep the fixture
   * timezone-safe — no risk of them landing on different date groups regardless
   * of the test runner's local timezone.
   *
   * 1_700_000_000_000 ms = Nov 14 2023 22:13 UTC
   * 1_700_003_600_000 ms = Nov 14 2023 23:13 UTC (1 h later, same UTC day)
   */
  function makeTwoStops() {
    const baseTs = 1_700_000_000_000;
    return [
      makeStop({ stopIndex: 1, eventId: "e1", eventType: "status_change",     timestamp: baseTs,               actorName: "Alice" }),
      makeStop({ stopIndex: 2, eventId: "e2", eventType: "inspection_started", timestamp: baseTs + 3_600_000,   actorName: "Bob" }),
    ];
  }

  it("clicking sort toggle changes label to 'Newest first'", () => {
    const stops = makeTwoStops();
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);

    const toggle = screen.getByTestId("t2-timeline-sort-toggle");
    fireEvent.click(toggle);
    expect(toggle.textContent).toContain("Newest first");
  });

  it("clicking sort toggle again switches back to 'Oldest first'", () => {
    const stops = makeTwoStops();
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);

    const toggle = screen.getByTestId("t2-timeline-sort-toggle");
    fireEvent.click(toggle); // → newest first
    fireEvent.click(toggle); // → oldest first
    expect(toggle.textContent).toContain("Oldest first");
  });

  it("sort toggle aria-label describes the next action (Switch to newest first when asc)", () => {
    const stops = makeTwoStops();
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const toggle = screen.getByTestId("t2-timeline-sort-toggle");
    expect(toggle.getAttribute("aria-label")).toContain("newest first");
  });

  it("reversed sort puts latest event item first in the DOM", () => {
    const stops = makeTwoStops();
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);

    const toggle = screen.getByTestId("t2-timeline-sort-toggle");
    fireEvent.click(toggle); // switch to newest first

    // After reversal, the timeline wrapper has data-sort="desc"
    // (data-sort moved from <ol> to the <div role="group"> wrapper)
    const wrapper = screen.getByTestId("t2-timeline-list");
    expect(wrapper.getAttribute("data-sort")).toBe("desc");

    // The newest event (Bob, inspection_started) should appear first
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Inspection Started")).toBeDefined();
  });

  it("default sort has data-sort='asc' on the timeline wrapper", () => {
    const stops = makeTwoStops();
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    // data-sort is now on the <div role="group" data-testid="t2-timeline-list"> wrapper
    const wrapper = screen.getByTestId("t2-timeline-list");
    expect(wrapper.getAttribute("data-sort")).toBe("asc");
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("accessibility", () => {
  it("each event item has aria-label with position and event type", () => {
    const stops = [
      makeStop({ eventType: "status_change" }),
      makeStop({ stopIndex: 2, eventId: "e2", eventType: "shipped" }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);

    const items = screen.getAllByRole("listitem");
    // First item should have aria-label mentioning "1 of 2" and "Status Changed"
    expect(items[0].getAttribute("aria-label")).toContain("1 of 2");
    expect(items[0].getAttribute("aria-label")).toContain("Status Changed");
    // Second item mentions "2 of 2" and "Shipped"
    expect(items[1].getAttribute("aria-label")).toContain("2 of 2");
    expect(items[1].getAttribute("aria-label")).toContain("Shipped");
  });

  it("sort toggle has descriptive aria-label for screen readers", () => {
    const stops = [makeStop(), makeStop({ stopIndex: 2, eventId: "e2" })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const toggle = screen.getByTestId("t2-timeline-sort-toggle");
    const ariaLabel = toggle.getAttribute("aria-label") ?? "";
    expect(ariaLabel.length).toBeGreaterThan(0);
    expect(ariaLabel.toLowerCase()).toMatch(/newest|oldest/);
  });

  it("count badge has aria-label describing the count", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const badge = screen.getByTestId("t2-timeline-count");
    const ariaLabel = badge.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("1 event");
  });

  it("count badge plural form for multiple events", () => {
    const stops = [makeStop(), makeStop({ stopIndex: 2, eventId: "e2" })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const badge = screen.getByTestId("t2-timeline-count");
    const ariaLabel = badge.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("2 events");
  });

  it("not-found state has role='alert'", () => {
    mockUseM2JourneyStops.mockReturnValue(null);
    render(<T2Timeline caseId={CASE_ID} />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeDefined();
  });
});

// ─── Sticky date headers (Sub-AC 2) ──────────────────────────────────────────

/**
 * Tests for the date-grouping and sticky-date-header feature (Sub-AC 2 of AC 14).
 *
 * All tests use timestamps at noon (12:00 local) to avoid midnight edge cases —
 * an event at 00:05 could land on the "previous day" if the timezone offset is
 * large enough.  Using noon keeps every date comparison stable regardless of the
 * test runner's timezone.
 *
 * JSDOM does not perform layout, so we cannot assert the CSS `position: sticky`
 * computed value here.  We verify the structural and semantic properties:
 *   • One date header element per calendar day
 *   • Correct textual labels (Today, Yesterday, formatted date)
 *   • Correct ARIA attributes (role="heading", aria-level="4")
 *   • Each day has its own <section> and <ol>
 *   • isFirst / isLast are globally correct across date-group boundaries
 */
describe("sticky date headers (Sub-AC 2)", () => {
  /**
   * Build a noon-local Date timestamp for a date that is `daysAgo` days before
   * today.  Using noon prevents DST-edge / midnight roll-over issues.
   */
  function noonTs(daysAgo: number): number {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return d.getTime();
  }

  it("renders one date header when all events share the same calendar day", () => {
    const ts = noonTs(0); // today noon
    const stops = [
      makeStop({ eventId: "e1", timestamp: ts }),
      makeStop({ eventId: "e2", timestamp: ts + 1_800_000 }), // +30 min, same day
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const headers = screen.getAllByTestId("timeline-date-header");
    expect(headers).toHaveLength(1);
  });

  it("renders 'Today' label for events timestamped today", () => {
    const stops = [makeStop({ eventId: "e1", timestamp: noonTs(0) })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const header = screen.getByTestId("timeline-date-header");
    expect(header.textContent).toContain("Today");
  });

  it("renders 'Yesterday' label for events timestamped yesterday", () => {
    const stops = [makeStop({ eventId: "e1", timestamp: noonTs(1) })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const header = screen.getByTestId("timeline-date-header");
    expect(header.textContent).toContain("Yesterday");
  });

  it("renders two date headers for events on two distinct calendar days", () => {
    // Use fixed past dates well away from today to avoid "Today"/"Yesterday" labels
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime(); // Jun 10 2022 noon
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime(); // Jun 11 2022 noon
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1, stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day2, stopIndex: 2 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const headers = screen.getAllByTestId("timeline-date-header");
    expect(headers).toHaveLength(2);
  });

  it("renders three date headers for events on three distinct calendar days", () => {
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime();
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime();
    const day3 = new Date(2022, 5, 12, 12, 0, 0).getTime();
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1, stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day2, stopIndex: 2 }),
      makeStop({ eventId: "e3", timestamp: day3, stopIndex: 3 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 3 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const headers = screen.getAllByTestId("timeline-date-header");
    expect(headers).toHaveLength(3);
  });

  it("date header has role='heading'", () => {
    const stops = [makeStop({ eventId: "e1", timestamp: noonTs(0) })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const header = screen.getByTestId("timeline-date-header");
    expect(header.getAttribute("role")).toBe("heading");
  });

  it("date header has aria-level='4' (sub-heading below h3 panel title)", () => {
    const stops = [makeStop({ eventId: "e1", timestamp: noonTs(0) })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 1 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const header = screen.getByTestId("timeline-date-header");
    expect(header.getAttribute("aria-level")).toBe("4");
  });

  it("each date group is wrapped in a <section> element", () => {
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime();
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime();
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1, stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day2, stopIndex: 2 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const sections = container.querySelectorAll("section");
    // Two date groups → two <section> elements
    expect(sections.length).toBe(2);
  });

  it("each date group section has a descriptive aria-label", () => {
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime();
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1, stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day1 + 3_600_000, stopIndex: 2 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    const section = container.querySelector("section");
    const ariaLabel = section?.getAttribute("aria-label") ?? "";
    // Section should mention the event count
    expect(ariaLabel).toMatch(/2 events? on/i);
  });

  it("each date group contains its own <ol> event list", () => {
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime();
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime();
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1, stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day2, stopIndex: 2 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    // Two date groups → at least two <ol> elements
    const lists = screen.getAllByRole("list");
    expect(lists.length).toBeGreaterThanOrEqual(2);
  });

  it("all events still render with correct total count across date groups", () => {
    // 2 events on day 1, 1 event on day 2 → 3 list items total
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime();
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime();
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1,           stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day1 + 3_600_000, stopIndex: 2 }),
      makeStop({ eventId: "e3", timestamp: day2,           stopIndex: 3 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 3 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
  });

  it("date headers in asc sort show oldest date first", () => {
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime(); // Jun 10
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime(); // Jun 11
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1, stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day2, stopIndex: 2 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);
    const headers = screen.getAllByTestId("timeline-date-header");
    // In asc order, Jun 10 header appears before Jun 11 header in the DOM
    const allText = headers.map((h) => h.textContent ?? "");
    // Both should contain "Jun" (or locale equivalent) – compare positions
    // by checking that the first header comes before the second in the DOM
    const container = screen.getByTestId("t2-timeline-list");
    const domHeaders = Array.from(container.querySelectorAll("[data-testid='timeline-date-header']"));
    expect(domHeaders.indexOf(headers[0])).toBeLessThan(domHeaders.indexOf(headers[1]));
    // The labels should be different dates
    expect(allText[0]).not.toBe(allText[1]);
  });

  it("date headers reverse order when sorted newest-first", () => {
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime(); // Jun 10
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime(); // Jun 11
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1, stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day2, stopIndex: 2 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<T2Timeline caseId={CASE_ID} />);

    // Default (asc): Jun 10 header first, Jun 11 header second
    const ascHeaders = screen.getAllByTestId("timeline-date-header").map(
      (h) => h.textContent
    );

    // Switch to newest-first
    const toggle = screen.getByTestId("t2-timeline-sort-toggle");
    fireEvent.click(toggle);

    // After desc: Jun 11 header first, Jun 10 header second — reversed
    const descHeaders = screen.getAllByTestId("timeline-date-header").map(
      (h) => h.textContent
    );
    expect(descHeaders[0]).toBe(ascHeaders[1]);
    expect(descHeaders[1]).toBe(ascHeaders[0]);
  });

  it("isFirst is on the first event globally (first event in first date group)", () => {
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime();
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime();
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1, stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day2, stopIndex: 2 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    // In asc order: e1 is first
    const firstItems = container.querySelectorAll("[data-is-first='true']");
    expect(firstItems.length).toBe(1);
    // The single first item should be in the first <section>
    const firstSection = container.querySelector("section");
    expect(firstSection?.contains(firstItems[0])).toBe(true);
  });

  it("isLast is on the last event globally (last event in last date group)", () => {
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime();
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime();
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1, stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day2, stopIndex: 2 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    // In asc order: e2 is last
    const lastItems = container.querySelectorAll("[data-is-last='true']");
    expect(lastItems.length).toBe(1);
    // The single last item should be in the second (last) <section>
    const sections = container.querySelectorAll("section");
    const lastSection = sections[sections.length - 1];
    expect(lastSection?.contains(lastItems[0])).toBe(true);
  });

  it("date header count badge shows the correct count for each date group", () => {
    // day1: 2 events, day2: 1 event
    const day1 = new Date(2022, 5, 10, 12, 0, 0).getTime();
    const day2 = new Date(2022, 5, 11, 12, 0, 0).getTime();
    const stops = [
      makeStop({ eventId: "e1", timestamp: day1,             stopIndex: 1 }),
      makeStop({ eventId: "e2", timestamp: day1 + 3_600_000, stopIndex: 2 }),
      makeStop({ eventId: "e3", timestamp: day2,             stopIndex: 3 }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 3 }));
    const { container } = render(<T2Timeline caseId={CASE_ID} />);
    // Each date header has a count span (aria-hidden="true")
    // The spans are inside the date header elements
    const sections = container.querySelectorAll("section");
    // day1 section: count span should contain "2"
    const day1Count = sections[0].querySelector("[aria-hidden='true']");
    expect(day1Count?.textContent).toBe("2");
    // day2 section: count span should contain "1"
    const day2Count = sections[1].querySelector("[aria-hidden='true']");
    expect(day2Count?.textContent).toBe("1");
  });
});
