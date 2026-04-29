/**
 * @vitest-environment jsdom
 *
 * T1TimelinePanel.test.tsx
 *
 * Unit tests for T1TimelinePanel
 * (src/components/CaseDetail/T1TimelinePanel.tsx)
 *
 * Sub-AC 3 of AC 120203: Scrollable vertical timeline panel container
 * positioned in the right 50% of the T1 grid, wiring the Convex query and
 * mapping events to TimelineEvent components with loading and empty states.
 *
 * Coverage matrix
 * ───────────────
 *
 * Data states:
 *   ✓ renders loading skeleton when events is undefined
 *   ✓ loading state has aria-busy="true"
 *   ✓ loading state has role="status"
 *   ✓ loading state renders 3 skeleton rows
 *   ✓ renders empty state when events array is empty
 *   ✓ empty state renders "No events yet" title
 *   ✓ empty state renders descriptive body text
 *   ✓ renders timeline with events when events are available
 *
 * Panel header:
 *   ✓ renders "Recent Activity" panel title
 *   ✓ count badge not shown in loading state
 *   ✓ count badge not shown when events is empty
 *   ✓ count badge shown when events are available
 *   ✓ count badge has aria-live="polite"
 *   ✓ count badge has aria-atomic="true"
 *   ✓ count badge shows correct event count
 *
 * Event list:
 *   ✓ renders an <ol> event list with aria-label
 *   ✓ renders correct number of TimelineEvent components
 *   ✓ events rendered newest-first (reversed from getCaseEvents order)
 *   ✓ first event has isFirst=true
 *   ✓ last event has isLast=true
 *   ✓ event receives correct eventType from CaseEvent
 *   ✓ event receives correct actorName (userName from CaseEvent)
 *   ✓ event receives correct timestamp
 *
 * Data mapping:
 *   ✓ status_change event data remapped (fromStatus→from, toStatus→to)
 *   ✓ other event types passed through data unchanged
 *   ✓ location derived from event data (lat, lng, locationName)
 *   ✓ hasCoordinates true when both lat and lng present
 *   ✓ hasCoordinates false when no lat/lng in data
 *
 * Convex wiring:
 *   ✓ useQuery called with getCaseEvents function
 *   ✓ useQuery called with the correct caseId argument
 *
 * Accessibility:
 *   ✓ root element has aria-labelledby pointing to panel title
 *   ✓ data-testid="t1-timeline-panel" on root
 *   ✓ data-testid="t1-timeline-skeleton" on loading skeleton
 *   ✓ data-testid="t1-timeline-empty" on empty state
 *   ✓ data-testid="t1-timeline-list" on event list
 *   ✓ data-testid="t1-timeline-count" on count badge
 *   ✓ data-testid="t1-timeline-event" on each event item
 *
 * Mocking strategy:
 *   • convex/react's useQuery is mocked to control loading/data states.
 *   • TimelineEvent is mocked as a simple <li> to verify props passed to it.
 *   • StatusPill is mocked to avoid CSS module issues.
 *   • No Convex provider needed.
 */

import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUseQuery = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

// Mock StatusPill to avoid CSS module + token issues in test env
vi.mock("@/components/StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind} />
  ),
}));

// Mock TimelineEvent with a minimal <li> that exposes the key props as
// data-attributes so we can assert what was passed without rendering full CSS
vi.mock("@/components/TimelineEvent/TimelineEvent", () => ({
  TimelineEvent: ({
    eventId,
    eventType,
    timestamp,
    actorName,
    metadata,
    location,
    hasCoordinates,
    isFirst,
    isLast,
    position,
    "data-testid": testId,
  }: {
    eventId?: string;
    eventType: string;
    timestamp: number;
    actorName?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>;
    location?: { lat?: number; lng?: number; locationName?: string };
    hasCoordinates?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    position?: { current: number; total: number };
    "data-testid"?: string;
  }) => (
    <li
      data-testid={testId ?? "timeline-event"}
      data-event-id={eventId}
      data-event-type={eventType}
      data-timestamp={timestamp}
      data-actor={actorName}
      data-has-coordinates={hasCoordinates ? "true" : "false"}
      data-is-first={isFirst ? "true" : "false"}
      data-is-last={isLast ? "true" : "false"}
      data-position-current={position?.current}
      data-position-total={position?.total}
      data-metadata-from={metadata?.from as string | undefined}
      data-metadata-to={metadata?.to as string | undefined}
      data-location-name={location?.locationName}
    />
  ),
}));

// Import AFTER mocks
import { T1TimelinePanel } from "../T1TimelinePanel";
import type { CaseEvent } from "../../../../convex/queries/events";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = "test-case-id-001";

function makeEvent(overrides: Partial<CaseEvent> = {}): CaseEvent {
  return {
    _id:       "evt-001",
    caseId:    CASE_ID,
    eventType: "status_change",
    userId:    "user-alice",
    userName:  "Alice Tech",
    timestamp: 1_700_000_000_000,
    data: {
      fromStatus:   "hangar",
      toStatus:     "deployed",
      lat:          42.3601,
      lng:          -71.0589,
      locationName: "Site Alpha",
    },
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: loading state
  mockUseQuery.mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
});

// ─── Data states ─────────────────────────────────────────────────────────────

describe("data states", () => {
  it("renders loading skeleton when events is undefined", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    expect(screen.getByTestId("t1-timeline-skeleton")).toBeDefined();
  });

  it("loading state has aria-busy='true'", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const skeleton = screen.getByTestId("t1-timeline-skeleton");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
  });

  it("loading state has role='status'", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const skeleton = screen.getByTestId("t1-timeline-skeleton");
    expect(skeleton.getAttribute("role")).toBe("status");
  });

  it("loading state renders 3 skeleton rows", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { container } = render(<T1TimelinePanel caseId={CASE_ID} />);
    // Count skeleton items via the CSS class pattern
    const skeletonItems = container.querySelectorAll("[data-testid='t1-timeline-skeleton'] > div");
    expect(skeletonItems).toHaveLength(3);
  });

  it("renders empty state when events array is empty", () => {
    mockUseQuery.mockReturnValue([]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    expect(screen.getByTestId("t1-timeline-empty")).toBeDefined();
  });

  it("empty state renders 'No events yet' title", () => {
    mockUseQuery.mockReturnValue([]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("empty state renders descriptive body text", () => {
    mockUseQuery.mockReturnValue([]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    // Look for partial match of the description text
    expect(
      screen.getByText(/Lifecycle events/, { exact: false })
    ).toBeDefined();
  });

  it("renders timeline when events are available", () => {
    mockUseQuery.mockReturnValue([makeEvent()]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    expect(screen.getByTestId("t1-timeline-panel")).toBeDefined();
    expect(screen.getByTestId("t1-timeline-list")).toBeDefined();
  });

  it("data-state='loading' when undefined", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const root = screen.getByTestId("t1-timeline-panel");
    expect(root.getAttribute("data-state")).toBe("loading");
  });

  it("data-state='empty' when no events", () => {
    mockUseQuery.mockReturnValue([]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const root = screen.getByTestId("t1-timeline-panel");
    expect(root.getAttribute("data-state")).toBe("empty");
  });

  it("data-state='loaded' when events available", () => {
    mockUseQuery.mockReturnValue([makeEvent()]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const root = screen.getByTestId("t1-timeline-panel");
    expect(root.getAttribute("data-state")).toBe("loaded");
  });
});

// ─── Panel header ─────────────────────────────────────────────────────────────

describe("panel header", () => {
  it("renders 'Recent Activity' panel title", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    expect(screen.getByText("Recent Activity")).toBeDefined();
  });

  it("count badge not shown in loading state", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    expect(screen.queryByTestId("t1-timeline-count")).toBeNull();
  });

  it("count badge not shown when events array is empty", () => {
    mockUseQuery.mockReturnValue([]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    expect(screen.queryByTestId("t1-timeline-count")).toBeNull();
  });

  it("count badge shown when events are available", () => {
    mockUseQuery.mockReturnValue([makeEvent()]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    expect(screen.getByTestId("t1-timeline-count")).toBeDefined();
  });

  it("count badge has aria-live='polite'", () => {
    mockUseQuery.mockReturnValue([makeEvent()]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const badge = screen.getByTestId("t1-timeline-count");
    expect(badge.getAttribute("aria-live")).toBe("polite");
  });

  it("count badge has aria-atomic='true'", () => {
    mockUseQuery.mockReturnValue([makeEvent()]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const badge = screen.getByTestId("t1-timeline-count");
    expect(badge.getAttribute("aria-atomic")).toBe("true");
  });

  it("count badge shows correct event count for single event", () => {
    mockUseQuery.mockReturnValue([makeEvent()]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const badge = screen.getByTestId("t1-timeline-count");
    expect(badge.textContent).toBe("1");
  });

  it("count badge shows correct event count for multiple events", () => {
    const events = [
      makeEvent({ _id: "evt-001" }),
      makeEvent({ _id: "evt-002" }),
      makeEvent({ _id: "evt-003" }),
    ];
    mockUseQuery.mockReturnValue(events);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const badge = screen.getByTestId("t1-timeline-count");
    expect(badge.textContent).toBe("3");
  });
});

// ─── Event list ───────────────────────────────────────────────────────────────

describe("event list", () => {
  it("renders an <ol> event list", () => {
    mockUseQuery.mockReturnValue([makeEvent()]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const list = screen.getByTestId("t1-timeline-list");
    expect(list.tagName).toBe("OL");
  });

  it("event list has descriptive aria-label", () => {
    mockUseQuery.mockReturnValue([makeEvent()]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const list = screen.getByTestId("t1-timeline-list");
    expect(list.getAttribute("aria-label")).toContain("recent event");
  });

  it("renders correct number of TimelineEvent items", () => {
    const events = [
      makeEvent({ _id: "evt-001" }),
      makeEvent({ _id: "evt-002" }),
      makeEvent({ _id: "evt-003" }),
    ];
    mockUseQuery.mockReturnValue(events);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const items = screen.getAllByTestId("t1-timeline-event");
    expect(items).toHaveLength(3);
  });

  it("events rendered newest-first (last server event appears first)", () => {
    // Server returns events oldest-first: evt-001 (old) → evt-002 (new)
    const events = [
      makeEvent({ _id: "evt-001", timestamp: 1_000_000_000 }),
      makeEvent({ _id: "evt-002", timestamp: 2_000_000_000 }),
    ];
    mockUseQuery.mockReturnValue(events);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const items = screen.getAllByTestId("t1-timeline-event");
    // First rendered item should be the newest (evt-002)
    expect(items[0].getAttribute("data-event-id")).toBe("evt-002");
    expect(items[1].getAttribute("data-event-id")).toBe("evt-001");
  });

  it("first rendered event has isFirst=true", () => {
    const events = [
      makeEvent({ _id: "evt-001", timestamp: 1_000_000_000 }),
      makeEvent({ _id: "evt-002", timestamp: 2_000_000_000 }),
    ];
    mockUseQuery.mockReturnValue(events);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const items = screen.getAllByTestId("t1-timeline-event");
    // First item (newest) should have isFirst=true
    expect(items[0].getAttribute("data-is-first")).toBe("true");
    expect(items[1].getAttribute("data-is-first")).toBe("false");
  });

  it("last rendered event has isLast=true", () => {
    const events = [
      makeEvent({ _id: "evt-001", timestamp: 1_000_000_000 }),
      makeEvent({ _id: "evt-002", timestamp: 2_000_000_000 }),
    ];
    mockUseQuery.mockReturnValue(events);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const items = screen.getAllByTestId("t1-timeline-event");
    // Last item (oldest) should have isLast=true
    expect(items[1].getAttribute("data-is-last")).toBe("true");
    expect(items[0].getAttribute("data-is-last")).toBe("false");
  });

  it("single event is both isFirst and isLast", () => {
    mockUseQuery.mockReturnValue([makeEvent()]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    expect(item.getAttribute("data-is-first")).toBe("true");
    expect(item.getAttribute("data-is-last")).toBe("true");
  });

  it("event receives correct eventType from CaseEvent", () => {
    mockUseQuery.mockReturnValue([makeEvent({ eventType: "custody_handoff" })]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    expect(item.getAttribute("data-event-type")).toBe("custody_handoff");
  });

  it("event receives correct actorName from CaseEvent.userName", () => {
    mockUseQuery.mockReturnValue([makeEvent({ userName: "Bob Pilot" })]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    expect(item.getAttribute("data-actor")).toBe("Bob Pilot");
  });

  it("event receives correct timestamp", () => {
    const ts = 1_700_000_000_000;
    mockUseQuery.mockReturnValue([makeEvent({ timestamp: ts })]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    expect(item.getAttribute("data-timestamp")).toBe(String(ts));
  });
});

// ─── Data mapping ─────────────────────────────────────────────────────────────

describe("data mapping", () => {
  it("status_change event data remaps fromStatus→from", () => {
    const event = makeEvent({
      eventType: "status_change",
      data: { fromStatus: "hangar", toStatus: "deployed" },
    });
    mockUseQuery.mockReturnValue([event]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    expect(item.getAttribute("data-metadata-from")).toBe("hangar");
  });

  it("status_change event data remaps toStatus→to", () => {
    const event = makeEvent({
      eventType: "status_change",
      data: { fromStatus: "hangar", toStatus: "deployed" },
    });
    mockUseQuery.mockReturnValue([event]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    expect(item.getAttribute("data-metadata-to")).toBe("deployed");
  });

  it("non-status_change events pass data through without remapping", () => {
    const event = makeEvent({
      eventType: "custody_handoff",
      data: { fromUserName: "Alice", toUserName: "Bob" },
    });
    mockUseQuery.mockReturnValue([event]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    // from/to should not be set (no remapping for custody_handoff)
    expect(item.getAttribute("data-metadata-from")).toBeFalsy();
    expect(item.getAttribute("data-metadata-to")).toBeFalsy();
  });

  it("location derived from event data lat/lng/locationName", () => {
    const event = makeEvent({
      data: { lat: 42.36, lng: -71.06, locationName: "Boston HQ" },
    });
    mockUseQuery.mockReturnValue([event]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    expect(item.getAttribute("data-location-name")).toBe("Boston HQ");
  });

  it("hasCoordinates true when both lat and lng present in data", () => {
    const event = makeEvent({
      data: { lat: 42.36, lng: -71.06 },
    });
    mockUseQuery.mockReturnValue([event]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    expect(item.getAttribute("data-has-coordinates")).toBe("true");
  });

  it("hasCoordinates false when no lat/lng in event data", () => {
    const event = makeEvent({
      data: { templateName: "Standard Kit", itemCount: 15 },
    });
    mockUseQuery.mockReturnValue([event]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const item = screen.getByTestId("t1-timeline-event");
    expect(item.getAttribute("data-has-coordinates")).toBe("false");
  });
});

// ─── Convex wiring ────────────────────────────────────────────────────────────

describe("Convex wiring", () => {
  it("useQuery called with the correct caseId argument", () => {
    mockUseQuery.mockReturnValue([]);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    // First argument to useQuery is the query function; second is the args object
    const callArgs = mockUseQuery.mock.calls[0];
    expect(callArgs[1]).toMatchObject({ caseId: CASE_ID });
  });

  it("passes caseId as the correct type to useQuery args", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId="cases_abc123" />);
    const callArgs = mockUseQuery.mock.calls[0];
    expect(callArgs[1].caseId).toBe("cases_abc123");
  });
});

// ─── Accessibility ─────────────────────────────────────────────────────────────

describe("accessibility", () => {
  it("root element has data-testid='t1-timeline-panel'", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    expect(screen.getByTestId("t1-timeline-panel")).toBeDefined();
  });

  it("root has aria-labelledby pointing to panel title heading", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const root = screen.getByTestId("t1-timeline-panel");
    const labelledBy = root.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    // The heading with that id should exist
    const heading = document.getElementById(labelledBy!);
    expect(heading).not.toBeNull();
  });

  it("skeleton has aria-label describing loading state", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const skeleton = screen.getByTestId("t1-timeline-skeleton");
    expect(skeleton.getAttribute("aria-label")).toBeTruthy();
  });

  it("event list aria-label contains 'event' for plural count", () => {
    const events = [
      makeEvent({ _id: "evt-001" }),
      makeEvent({ _id: "evt-002" }),
    ];
    mockUseQuery.mockReturnValue(events);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const list = screen.getByTestId("t1-timeline-list");
    expect(list.getAttribute("aria-label")).toContain("events");
  });

  it("each TimelineEvent gets data-testid='t1-timeline-event'", () => {
    const events = [
      makeEvent({ _id: "evt-001" }),
      makeEvent({ _id: "evt-002" }),
    ];
    mockUseQuery.mockReturnValue(events);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const items = screen.getAllByTestId("t1-timeline-event");
    expect(items).toHaveLength(2);
  });

  it("data-event-count attribute reflects number of events", () => {
    const events = [makeEvent({ _id: "evt-001" }), makeEvent({ _id: "evt-002" })];
    mockUseQuery.mockReturnValue(events);
    render(<T1TimelinePanel caseId={CASE_ID} />);
    const root = screen.getByTestId("t1-timeline-panel");
    expect(root.getAttribute("data-event-count")).toBe("2");
  });
});
