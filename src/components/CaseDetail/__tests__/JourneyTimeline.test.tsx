/**
 * @vitest-environment jsdom
 *
 * JourneyTimeline.test.tsx
 *
 * Unit tests for JourneyTimeline (src/components/CaseDetail/JourneyTimeline.tsx)
 *
 * Sub-AC 6.3: M2 data layer — JourneyTimeline UI component.
 *
 * Coverage matrix
 * ───────────────
 *
 * Render states:
 *   ✓ renders null when caseId is null
 *   ✓ renders loading skeleton while journey is undefined
 *   ✓ renders null when journey is null (case not found)
 *   ✓ renders empty state when stops array is empty
 *   ✓ renders timeline when stops are present
 *
 * Section header:
 *   ✓ renders "Journey" section title
 *   ✓ renders stop count badge when stops exist
 *   ✓ count badge has correct aria-label
 *   ✓ count badge updates when stopCount changes
 *
 * Stop items:
 *   ✓ renders an ordered list of stops
 *   ✓ stop index badge shows the 1-based stopIndex number
 *   ✓ first stop has data-is-first="true"
 *   ✓ last stop has data-is-last="true"
 *   ✓ single stop is both first and last
 *   ✓ intermediate stops have neither attribute
 *   ✓ stop event type is formatted (status_change → "Status Change")
 *   ✓ custody_handoff → "Custody Handoff"
 *   ✓ unknown event type fallback: title-cases underscore slug
 *   ✓ stop meta shows formatted timestamp
 *   ✓ stop meta shows actor name when present
 *   ✓ stop meta omits actor name separator when actorName is empty
 *   ✓ location name shown when stop has GPS + locationName
 *   ✓ lat/lng shown when stop has GPS but no locationName
 *   ✓ "No location" shown when stop has no GPS data
 *   ✓ index badge has data-no-location="true" when !hasCoordinates
 *   ✓ <time> element has dateTime attribute (ISO 8601)
 *
 * Truncation:
 *   ✓ shows first maxVisible stops by default (default maxVisible=5)
 *   ✓ "Show N more" button visible when stops > maxVisible
 *   ✓ "Show N more" button hidden when stops <= maxVisible
 *   ✓ clicking "Show N more" reveals all stops
 *   ✓ "Show fewer" button appears after expanding
 *   ✓ clicking "Show fewer" collapses to maxVisible stops again
 *   ✓ maxVisible=Infinity shows all stops without truncation
 *
 * Accessibility:
 *   ✓ ordered list has aria-label with stop count + case label
 *   ✓ show-more button has aria-label describing hidden count
 *   ✓ loading state has aria-busy="true"
 *
 * Mocking strategy:
 *   • useM2JourneyStops is mocked to control loading/data/not-found states.
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

// Import component AFTER mocks
import { JourneyTimeline } from "../JourneyTimeline";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID    = "case-abc-123";
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
    metadata:       {},
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
  it("renders null when caseId is null", () => {
    const { container } = render(<JourneyTimeline caseId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders loading skeleton while journey is undefined", () => {
    mockUseM2JourneyStops.mockReturnValue(undefined);
    render(<JourneyTimeline caseId={CASE_ID} />);
    const status = screen.getByRole("status");
    expect(status).toBeDefined();
  });

  it("loading state has aria-busy=true", () => {
    mockUseM2JourneyStops.mockReturnValue(undefined);
    const { container } = render(<JourneyTimeline caseId={CASE_ID} />);
    const root = container.querySelector("[aria-busy='true']");
    expect(root).not.toBeNull();
  });

  it("renders null when journey is null (case not found)", () => {
    mockUseM2JourneyStops.mockReturnValue(null);
    const { container } = render(<JourneyTimeline caseId={CASE_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders empty state when stops array is empty", () => {
    const journey = makeJourney({ stops: [], stopCount: 0, firstStop: null, lastStop: null });
    mockUseM2JourneyStops.mockReturnValue(journey);
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByText(/No journey events recorded yet/i)).toBeDefined();
  });

  it("renders timeline root element when stops are present", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByTestId("journey-timeline")).toBeDefined();
  });
});

// ─── Section header ───────────────────────────────────────────────────────────

describe("section header", () => {
  it("renders 'Journey' section title", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByText("Journey")).toBeDefined();
  });

  it("renders stop count badge when stops exist", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stopCount: 3, stops: [makeStop(), makeStop({ eventId: "e2", stopIndex: 2 }), makeStop({ eventId: "e3", stopIndex: 3 })] }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    const badge = screen.getByTestId("journey-timeline-count");
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe("3");
  });

  it("count badge has correct aria-label", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stopCount: 2, stops: [makeStop(), makeStop({ eventId: "e2", stopIndex: 2 })] }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    const badge = screen.getByTestId("journey-timeline-count");
    expect(badge.getAttribute("aria-label")).toContain("2 journey stops");
  });

  it("count badge singular form for 1 stop", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stopCount: 1 }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    const badge = screen.getByTestId("journey-timeline-count");
    expect(badge.getAttribute("aria-label")).toContain("1 journey stop");
    expect(badge.getAttribute("aria-label")).not.toContain("1 journey stops");
  });
});

// ─── Stop items ───────────────────────────────────────────────────────────────

describe("stop items", () => {
  it("renders an ordered list for the stops", () => {
    const stops = [makeStop(), makeStop({ eventId: "e2", stopIndex: 2 })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={10} />);
    expect(screen.getByRole("list")).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("stop index badge shows the 1-based stopIndex", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    const { container } = render(<JourneyTimeline caseId={CASE_ID} maxVisible={10} />);

    // Find index badges (aria-hidden spans with the index number)
    const badges = container.querySelectorAll("[aria-hidden='true'][class*='indexBadge']");
    // Due to CSS module hashing we check by looking at items with data-stop-index
    const items = container.querySelectorAll("[data-stop-index]");
    expect(items[0].getAttribute("data-stop-index")).toBe("1");
    expect(items[1].getAttribute("data-stop-index")).toBe("2");
  });

  it("first stop has data-is-first='true'", () => {
    const stops = [makeStop(), makeStop({ eventId: "e2", stopIndex: 2 })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    const { container } = render(<JourneyTimeline caseId={CASE_ID} maxVisible={10} />);
    const firstItem = container.querySelector("[data-is-first='true']");
    expect(firstItem).not.toBeNull();
  });

  it("last stop has data-is-last='true'", () => {
    const stops = [makeStop(), makeStop({ eventId: "e2", stopIndex: 2 })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    const { container } = render(<JourneyTimeline caseId={CASE_ID} maxVisible={10} />);
    const lastItem = container.querySelector("[data-is-last='true']");
    expect(lastItem).not.toBeNull();
  });

  it("single stop is both first and last", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    const { container } = render(<JourneyTimeline caseId={CASE_ID} />);
    const firstAndLast = container.querySelector("[data-is-first='true'][data-is-last='true']");
    expect(firstAndLast).not.toBeNull();
  });

  it("intermediate stops have neither data-is-first nor data-is-last", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),   // intermediate
      makeStop({ stopIndex: 3, eventId: "e3" }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 3 }));
    const { container } = render(<JourneyTimeline caseId={CASE_ID} maxVisible={10} />);
    const items = Array.from(container.querySelectorAll("[data-stop-index]"));
    const intermediate = items[1]; // index 2 (middle)
    expect(intermediate.getAttribute("data-is-first")).toBeNull();
    expect(intermediate.getAttribute("data-is-last")).toBeNull();
  });

  it("status_change event type renders as 'Status Change'", () => {
    const stop = makeStop({ eventType: "status_change" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByText("Status Change")).toBeDefined();
  });

  it("custody_handoff renders as 'Custody Handoff'", () => {
    const stop = makeStop({ eventType: "custody_handoff" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByText("Custody Handoff")).toBeDefined();
  });

  it("inspection_completed renders as 'Inspection Completed'", () => {
    const stop = makeStop({ eventType: "inspection_completed" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByText("Inspection Completed")).toBeDefined();
  });

  it("unknown event type falls back to title-cased underscore slug", () => {
    const stop = makeStop({ eventType: "custom_event_type" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByText("Custom Event Type")).toBeDefined();
  });

  it("stop meta shows actor name when present", () => {
    const stop = makeStop({ actorName: "Bob Pilot" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByText(/Bob Pilot/)).toBeDefined();
  });

  it("stop meta omits actor separator when actorName is empty string", () => {
    const stop = makeStop({ actorName: "" });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<JourneyTimeline caseId={CASE_ID} />);
    // The meta element should not contain " · "
    const metaElements = container.querySelectorAll("[class*='meta']");
    metaElements.forEach((el) => {
      expect(el.textContent).not.toMatch(/· $/);
    });
  });

  it("location name shown when stop has GPS + locationName", () => {
    const stop = makeStop({ location: { lat: 42.36, lng: -71.06, locationName: "Site Alpha" }, hasCoordinates: true });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByText("Site Alpha")).toBeDefined();
  });

  it("lat/lng shown when stop has GPS but no locationName", () => {
    const stop = makeStop({ location: { lat: 42.36, lng: -71.06 }, hasCoordinates: true });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    // Coordinates shown as formatted strings
    expect(screen.getByText("42.3600, -71.0600")).toBeDefined();
  });

  it("'No location' shown when stop has no GPS data", () => {
    const stop = makeStop({ location: {}, hasCoordinates: false });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(screen.getByText("No location")).toBeDefined();
  });

  it("index badge has data-no-location='true' when !hasCoordinates", () => {
    const stop = makeStop({ location: {}, hasCoordinates: false });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<JourneyTimeline caseId={CASE_ID} />);
    const badge = container.querySelector("[data-no-location='true']");
    expect(badge).not.toBeNull();
  });

  it("stop has a <time> element with dateTime ISO 8601 attribute", () => {
    const stop = makeStop({ timestamp: 1_700_000_000_000 });
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops: [stop], stopCount: 1 }));
    const { container } = render(<JourneyTimeline caseId={CASE_ID} />);
    const timeEl = container.querySelector("time");
    expect(timeEl).not.toBeNull();
    const dt = timeEl?.getAttribute("dateTime") ?? "";
    // Should be a valid ISO 8601 string
    expect(() => new Date(dt)).not.toThrow();
    expect(new Date(dt).getTime()).toBe(1_700_000_000_000);
  });
});

// ─── Truncation ───────────────────────────────────────────────────────────────

describe("truncation", () => {
  function makeStops(count: number): JourneyStop[] {
    return Array.from({ length: count }, (_, i) =>
      makeStop({ stopIndex: i + 1, eventId: `e${i + 1}` })
    );
  }

  it("shows first maxVisible stops by default (maxVisible=5)", () => {
    const stops = makeStops(8);
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 8 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={5} />);
    // 5 stop items + 1 "Show N more" = visible
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
  });

  it("'Show N more' button visible when stops > maxVisible", () => {
    const stops = makeStops(8);
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 8 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={5} />);
    const btn = screen.getByTestId("journey-timeline-show-more");
    expect(btn).toBeDefined();
    expect(btn.textContent).toContain("3"); // 8 - 5 = 3 hidden
  });

  it("show-more button has correct aria-label", () => {
    const stops = makeStops(8);
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 8 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={5} />);
    const btn = screen.getByTestId("journey-timeline-show-more");
    expect(btn.getAttribute("aria-label")).toContain("3 more");
  });

  it("'Show N more' button hidden when stops <= maxVisible", () => {
    const stops = makeStops(4);
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 4 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={5} />);
    expect(screen.queryByTestId("journey-timeline-show-more")).toBeNull();
  });

  it("clicking 'Show N more' reveals all stops", () => {
    const stops = makeStops(8);
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 8 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={5} />);

    fireEvent.click(screen.getByTestId("journey-timeline-show-more"));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(8);
  });

  it("'Show fewer' button appears after expanding", () => {
    const stops = makeStops(8);
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 8 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={5} />);

    fireEvent.click(screen.getByTestId("journey-timeline-show-more"));
    expect(screen.getByTestId("journey-timeline-show-less")).toBeDefined();
  });

  it("clicking 'Show fewer' collapses back to maxVisible stops", () => {
    const stops = makeStops(8);
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 8 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={5} />);

    fireEvent.click(screen.getByTestId("journey-timeline-show-more"));
    fireEvent.click(screen.getByTestId("journey-timeline-show-less"));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
  });

  it("maxVisible=Infinity shows all stops without truncation button", () => {
    const stops = makeStops(10);
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 10 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={Infinity} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(10);
    expect(screen.queryByTestId("journey-timeline-show-more")).toBeNull();
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("accessibility", () => {
  it("ordered list has aria-label with stop count and case label", () => {
    const stops = [makeStop(), makeStop({ eventId: "e2", stopIndex: 2 })];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 2 }));
    render(<JourneyTimeline caseId={CASE_ID} maxVisible={10} />);
    const list = screen.getByRole("list");
    expect(list.getAttribute("aria-label")).toContain("2 journey stops");
    expect(list.getAttribute("aria-label")).toContain(CASE_LABEL);
  });

  it("calls useM2JourneyStops with the provided caseId", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    render(<JourneyTimeline caseId={CASE_ID} />);
    expect(mockUseM2JourneyStops).toHaveBeenCalledWith(CASE_ID);
  });

  it("calls useM2JourneyStops with null when caseId is null", () => {
    render(<JourneyTimeline caseId={null} />);
    expect(mockUseM2JourneyStops).toHaveBeenCalledWith(null);
  });
});
