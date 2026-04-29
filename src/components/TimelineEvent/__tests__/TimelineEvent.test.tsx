/**
 * @vitest-environment jsdom
 *
 * TimelineEvent.test.tsx
 *
 * Unit tests for the reusable TimelineEvent component.
 * (src/components/TimelineEvent/TimelineEvent.tsx)
 *
 * Sub-AC 2 of AC 120202: Reusable TimelineEvent component that renders a
 * single event entry with icon, timestamp, actor, and description appropriate
 * to event type (status change, scan, handoff).
 *
 * Coverage matrix
 * ───────────────
 *
 * Basic rendering:
 *   ✓ renders an <li> element by default
 *   ✓ forwards data-testid to the root element
 *   ✓ forwards data-event-type to the root element
 *   ✓ renders event type label for known type (status_change → "Status Changed")
 *   ✓ renders Title-Cased label for unknown event type slug
 *   ✓ accepts custom label override via label prop
 *   ✓ renders timestamp in <time> element with ISO 8601 dateTime
 *   ✓ renders actor name when provided
 *   ✓ renders no actor name when omitted (meta line still renders)
 *
 * Spine dot:
 *   ✓ renders .dot element (data-testid="timeline-event-dot")
 *   ✓ dot has data-variant="brand" for status_change
 *   ✓ dot has data-variant="brand" for mission_assigned
 *   ✓ dot has data-variant="transit" for inspection_started
 *   ✓ dot has data-variant="transit" for shipped
 *   ✓ dot has data-variant="success" for inspection_completed
 *   ✓ dot has data-variant="success" for delivered
 *   ✓ dot has data-variant="error" for damage_reported
 *   ✓ dot has data-variant="neutral" for custody_handoff
 *   ✓ dot has data-variant="neutral" for template_applied
 *   ✓ dot has data-variant="neutral" for unknown event types
 *   ✓ dot has data-no-location="true" when hasCoordinates=false
 *   ✓ dot has no data-no-location when hasCoordinates=true
 *
 * Thread (spine connector):
 *   ✓ thread renders by default (not isLast)
 *   ✓ isLast adds data-is-last="true" to the <li>
 *   ✓ isFirst adds data-is-first="true" to the <li>
 *   ✓ isFirst and isLast can both be true simultaneously (single event)
 *
 * Position / aria-label:
 *   ✓ renders aria-label with "Event N of M: Type" when position is provided
 *   ✓ renders aria-label with only event type when position is omitted
 *
 * StatusPill:
 *   ✓ renders StatusPill for status_change with status=to value (deployed)
 *   ✓ renders StatusPill for status_change with status=to value (assembled)
 *   ✓ renders StatusPill kind="flagged" for damage_reported
 *   ✓ renders StatusPill kind="transit_out" for shipped
 *   ✓ renders StatusPill kind="received" for delivered
 *   ✓ does NOT render StatusPill for inspection_started
 *   ✓ does NOT render StatusPill for template_applied
 *   ✓ does NOT render StatusPill for custody_handoff
 *   ✓ does NOT render StatusPill for status_change with unknown to value
 *
 * Event descriptions (per type):
 *   ✓ status_change: renders "from" status text
 *   ✓ status_change: renders "to" status text
 *   ✓ status_change: renders arrow between from and to
 *   ✓ status_change: renders nothing when metadata is empty
 *   ✓ inspection_started: renders "N / M items" progress
 *   ✓ inspection_completed: renders "N / M items · D damaged" (with damage)
 *   ✓ inspection_completed: renders "N / M items" without damaged count when 0
 *   ✓ inspection_completed: renders nothing when totalItems is absent
 *   ✓ damage_reported: renders itemName + severity
 *   ✓ damage_reported: renders only severity when itemName absent
 *   ✓ damage_reported: renders nothing when both are absent
 *   ✓ shipped: renders trackingNumber
 *   ✓ shipped: renders "origin → destination" route
 *   ✓ shipped: renders "→ destination" when originName absent
 *   ✓ shipped: renders nothing when trackingNumber and destinationName absent
 *   ✓ custody_handoff: renders fromUserName → toUserName
 *   ✓ custody_handoff: renders only toUserName when fromUserName absent
 *   ✓ custody_handoff: renders nothing when both absent
 *   ✓ mission_assigned: renders missionName
 *   ✓ mission_assigned: renders nothing when missionName absent
 *   ✓ template_applied: renders templateName · itemCount items
 *   ✓ template_applied: renders only templateName when itemCount absent
 *   ✓ unknown event types: renders no description block
 *
 * Location:
 *   ✓ renders location name when provided in location.locationName
 *   ✓ renders coordinates when location.lat and location.lng are present
 *   ✓ prefers locationName over coordinates when both present
 *   ✓ renders "No location recorded" when hasCoordinates=false
 *   ✓ renders "No location recorded" when location prop is absent
 *
 * Static helper — fromStop():
 *   ✓ fromStop() sets isFirst=true for index 0
 *   ✓ fromStop() sets isLast=true for the last index
 *   ✓ fromStop() sets position.current = index + 1
 *   ✓ fromStop() sets position.total = total
 *   ✓ fromStop() copies eventType, timestamp, actorName, metadata, location
 *
 * Vocabulary helpers (formatEventType):
 *   ✓ formatEventType returns label for known type
 *   ✓ formatEventType returns Title Case for unknown type
 *
 * Accessibility:
 *   ✓ timestamp wrapped in <time> with dateTime attribute
 *   ✓ spine dot is aria-hidden (part of the spineCol aria-hidden group)
 *   ✓ metaSep separator is aria-hidden
 *   ✓ event item has aria-label when position is set
 *
 * Mocking strategy:
 *   • StatusPill mocked as a simple span to avoid CSS module issues.
 *   • No Convex provider needed — component is purely presentational.
 */

import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { JourneyStop } from "@/hooks/use-m2-journey-stops";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock StatusPill as a simple testable span
vi.mock("@/components/StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind} />
  ),
}));

// Import AFTER mocks
import { TimelineEvent, formatEventType } from "../TimelineEvent";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_TIMESTAMP = 1_700_000_000_000;  // Nov 14 2023

function makeStop(overrides: Partial<JourneyStop> = {}): JourneyStop {
  return {
    stopIndex:      1,
    eventId:        "evt-001",
    eventType:      "status_change",
    timestamp:      BASE_TIMESTAMP,
    location:       { lat: 42.36, lng: -71.06, locationName: "Site Alpha" },
    hasCoordinates: true,
    actorId:        "user-alice",
    actorName:      "Alice Tech",
    metadata:       { from: "hangar", to: "deployed" },
    ...overrides,
  };
}

// Helper to render a TimelineEvent inside an <ol> (required for valid HTML/ARIA)
function renderEvent(props: React.ComponentProps<typeof TimelineEvent>) {
  return render(
    <ol>
      <TimelineEvent {...props} />
    </ol>
  );
}

// ─── Setup ────────────────────────────────────────────────────────────────────

afterEach(() => cleanup());

// ─── Basic rendering ──────────────────────────────────────────────────────────

describe("basic rendering", () => {
  it("renders an <li> element by default", () => {
    renderEvent({ eventType: "status_change", timestamp: BASE_TIMESTAMP });
    const item = screen.getByRole("listitem");
    expect(item.tagName).toBe("LI");
  });

  it("forwards data-testid to the root element", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      "data-testid": "my-event",
    });
    expect(screen.getByTestId("my-event")).toBeDefined();
  });

  it("forwards data-event-type to the root element", () => {
    const { container } = renderEvent({
      eventType: "shipped",
      timestamp: BASE_TIMESTAMP,
    });
    const item = container.querySelector("[data-event-type='shipped']");
    expect(item).not.toBeNull();
  });

  it("renders 'Status Changed' for status_change event type", () => {
    renderEvent({ eventType: "status_change", timestamp: BASE_TIMESTAMP });
    expect(screen.getByTestId("timeline-event-type").textContent).toBe("Status Changed");
  });

  it("renders 'Inspection Started' for inspection_started event type", () => {
    renderEvent({ eventType: "inspection_started", timestamp: BASE_TIMESTAMP });
    expect(screen.getByTestId("timeline-event-type").textContent).toBe("Inspection Started");
  });

  it("renders 'Custody Handoff' for custody_handoff event type", () => {
    renderEvent({ eventType: "custody_handoff", timestamp: BASE_TIMESTAMP });
    expect(screen.getByTestId("timeline-event-type").textContent).toBe("Custody Handoff");
  });

  it("renders Title-Cased label for unknown event type slug", () => {
    renderEvent({ eventType: "custom_event_type", timestamp: BASE_TIMESTAMP });
    expect(screen.getByTestId("timeline-event-type").textContent).toBe("Custom Event Type");
  });

  it("accepts a custom label override via the label prop", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      label: "Custom Label Override",
    });
    expect(screen.getByTestId("timeline-event-type").textContent).toBe("Custom Label Override");
  });

  it("renders timestamp in <time> element with ISO 8601 dateTime", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
    });
    const timeEl = container.querySelector("time[data-testid='timeline-event-timestamp']");
    expect(timeEl).not.toBeNull();
    const dt = timeEl?.getAttribute("dateTime") ?? "";
    expect(new Date(dt).getTime()).toBe(BASE_TIMESTAMP);
  });

  it("renders actor name when provided", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      actorName: "Bob Pilot",
    });
    expect(screen.getByTestId("timeline-event-actor").textContent).toBe("Bob Pilot");
  });

  it("does not render actor element when actorName is omitted", () => {
    renderEvent({ eventType: "status_change", timestamp: BASE_TIMESTAMP });
    expect(screen.queryByTestId("timeline-event-actor")).toBeNull();
  });
});

// ─── Spine dot ────────────────────────────────────────────────────────────────

describe("spine dot", () => {
  const dotCases: Array<[string, string]> = [
    ["status_change",        "brand"],
    ["mission_assigned",     "brand"],
    ["inspection_started",   "transit"],
    ["shipped",              "transit"],
    ["inspection_completed", "success"],
    ["delivered",            "success"],
    ["damage_reported",      "error"],
    ["custody_handoff",      "neutral"],
    ["template_applied",     "neutral"],
  ];

  it.each(dotCases)(
    "dot has data-variant='%s' for event type %s",
    (eventType, expectedVariant) => {
      const { container } = renderEvent({ eventType, timestamp: BASE_TIMESTAMP });
      const dot = container.querySelector("[data-testid='timeline-event-dot']");
      expect(dot?.getAttribute("data-variant")).toBe(expectedVariant);
    }
  );

  it("dot has data-variant='neutral' for unknown event types", () => {
    const { container } = renderEvent({
      eventType: "completely_unknown_event",
      timestamp: BASE_TIMESTAMP,
    });
    const dot = container.querySelector("[data-testid='timeline-event-dot']");
    expect(dot?.getAttribute("data-variant")).toBe("neutral");
  });

  it("dot has data-no-location='true' when hasCoordinates=false", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      hasCoordinates: false,
    });
    const dot = container.querySelector("[data-testid='timeline-event-dot']");
    expect(dot?.getAttribute("data-no-location")).toBe("true");
  });

  it("dot has no data-no-location when hasCoordinates=true", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      hasCoordinates: true,
      location: { lat: 42.36, lng: -71.06 },
    });
    const dot = container.querySelector("[data-testid='timeline-event-dot']");
    expect(dot?.getAttribute("data-no-location")).toBeNull();
  });
});

// ─── Thread and position flags ────────────────────────────────────────────────

describe("thread and position flags", () => {
  it("thread renders by default (when not isLast)", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      isLast: false,
    });
    const thread = container.querySelector("[data-testid='timeline-event-thread']");
    expect(thread).not.toBeNull();
  });

  it("isLast adds data-is-last='true' to the <li>", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      isLast: true,
    });
    const item = container.querySelector("[data-is-last='true']");
    expect(item).not.toBeNull();
  });

  it("isFirst adds data-is-first='true' to the <li>", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      isFirst: true,
    });
    const item = container.querySelector("[data-is-first='true']");
    expect(item).not.toBeNull();
  });

  it("isFirst and isLast can both be true (single-event timeline)", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      isFirst: true,
      isLast: true,
    });
    const item = container.querySelector("[data-is-first='true'][data-is-last='true']");
    expect(item).not.toBeNull();
  });

  it("neither isFirst nor isLast when both omitted (defaults to false)", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
    });
    const li = container.querySelector("li");
    expect(li?.getAttribute("data-is-first")).toBeNull();
    expect(li?.getAttribute("data-is-last")).toBeNull();
  });
});

// ─── Aria-label / position ────────────────────────────────────────────────────

describe("aria-label / position", () => {
  it("renders 'Event N of M: Type' in aria-label when position is provided", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      position: { current: 2, total: 5 },
    });
    const item = screen.getByRole("listitem");
    expect(item.getAttribute("aria-label")).toBe("Event 2 of 5: Status Changed");
  });

  it("renders only event type in aria-label when position is omitted", () => {
    renderEvent({
      eventType: "shipped",
      timestamp: BASE_TIMESTAMP,
    });
    const item = screen.getByRole("listitem");
    expect(item.getAttribute("aria-label")).toBe("Shipped");
  });

  it("uses custom label in aria-label when label prop is set", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      label: "My Custom Label",
      position: { current: 1, total: 1 },
    });
    const item = screen.getByRole("listitem");
    expect(item.getAttribute("aria-label")).toBe("Event 1 of 1: My Custom Label");
  });
});

// ─── StatusPill ───────────────────────────────────────────────────────────────

describe("StatusPill", () => {
  it("renders StatusPill for status_change with 'deployed' to value", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      metadata: { from: "hangar", to: "deployed" },
    });
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("deployed");
  });

  it("renders StatusPill for status_change with 'assembled' to value", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      metadata: { from: "hangar", to: "assembled" },
    });
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("assembled");
  });

  it("renders StatusPill kind='flagged' for damage_reported", () => {
    renderEvent({
      eventType: "damage_reported",
      timestamp: BASE_TIMESTAMP,
      metadata: {},
    });
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("flagged");
  });

  it("renders StatusPill kind='transit_out' for shipped", () => {
    renderEvent({
      eventType: "shipped",
      timestamp: BASE_TIMESTAMP,
      metadata: { trackingNumber: "794644823741" },
    });
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("transit_out");
  });

  it("renders StatusPill kind='received' for delivered", () => {
    renderEvent({
      eventType: "delivered",
      timestamp: BASE_TIMESTAMP,
      metadata: {},
    });
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("received");
  });

  it("does NOT render StatusPill for inspection_started", () => {
    renderEvent({
      eventType: "inspection_started",
      timestamp: BASE_TIMESTAMP,
    });
    expect(screen.queryByTestId("status-pill")).toBeNull();
  });

  it("does NOT render StatusPill for template_applied", () => {
    renderEvent({
      eventType: "template_applied",
      timestamp: BASE_TIMESTAMP,
      metadata: { templateName: "Standard Kit", itemCount: 10 },
    });
    expect(screen.queryByTestId("status-pill")).toBeNull();
  });

  it("does NOT render StatusPill for custody_handoff", () => {
    renderEvent({
      eventType: "custody_handoff",
      timestamp: BASE_TIMESTAMP,
      metadata: { toUserName: "Bob" },
    });
    expect(screen.queryByTestId("status-pill")).toBeNull();
  });

  it("does NOT render StatusPill when status_change 'to' is an unrecognized status", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      metadata: { from: "unknown_a", to: "unknown_b" },
    });
    expect(screen.queryByTestId("status-pill")).toBeNull();
  });
});

// ─── Event descriptions ───────────────────────────────────────────────────────

describe("event descriptions", () => {
  // ── status_change ──

  it("status_change: renders 'from' status text", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      metadata: { from: "hangar", to: "assembled" },
    });
    expect(screen.getByText("hangar")).toBeDefined();
  });

  it("status_change: renders 'to' status text", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      metadata: { from: "hangar", to: "assembled" },
    });
    expect(screen.getByText("assembled")).toBeDefined();
  });

  it("status_change: renders arrow between from and to (aria-hidden)", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      metadata: { from: "hangar", to: "assembled" },
    });
    const desc = container.querySelector("[data-testid='timeline-event-description']");
    // The statusArrow span inside the description is aria-hidden
    const arrowEl = desc?.querySelector("[aria-hidden='true']");
    expect(arrowEl?.textContent).toContain("→");
  });

  it("status_change: renders no description block when metadata is empty", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      metadata: {},
    });
    expect(screen.queryByTestId("timeline-event-description")).toBeNull();
  });

  // ── inspection_started / completed ──

  it("inspection_started: renders 'N / M items' progress", () => {
    renderEvent({
      eventType: "inspection_started",
      timestamp: BASE_TIMESTAMP,
      metadata: { totalItems: 15, checkedItems: 8 },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toContain("8 / 15 items");
  });

  it("inspection_completed: renders 'N / M items · D damaged' with damage count", () => {
    renderEvent({
      eventType: "inspection_completed",
      timestamp: BASE_TIMESTAMP,
      metadata: { totalItems: 20, checkedItems: 18, damagedItems: 2 },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toContain("18 / 20 items");
    expect(desc.textContent).toContain("2 damaged");
  });

  it("inspection_completed: omits damaged line when damagedItems is 0", () => {
    renderEvent({
      eventType: "inspection_completed",
      timestamp: BASE_TIMESTAMP,
      metadata: { totalItems: 20, checkedItems: 20, damagedItems: 0 },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).not.toContain("damaged");
  });

  it("inspection_completed: renders nothing when totalItems is absent", () => {
    renderEvent({
      eventType: "inspection_completed",
      timestamp: BASE_TIMESTAMP,
      metadata: {},
    });
    expect(screen.queryByTestId("timeline-event-description")).toBeNull();
  });

  // ── damage_reported ──

  it("damage_reported: renders itemName and severity", () => {
    renderEvent({
      eventType: "damage_reported",
      timestamp: BASE_TIMESTAMP,
      metadata: { itemName: "Blade tip", severity: "Severe" },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toContain("Blade tip");
    expect(desc.textContent).toContain("Severe");
  });

  it("damage_reported: renders only severity when itemName is absent", () => {
    renderEvent({
      eventType: "damage_reported",
      timestamp: BASE_TIMESTAMP,
      metadata: { severity: "Minor" },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toBe("Minor");
  });

  it("damage_reported: renders nothing when both itemName and severity absent", () => {
    renderEvent({
      eventType: "damage_reported",
      timestamp: BASE_TIMESTAMP,
      metadata: {},
    });
    expect(screen.queryByTestId("timeline-event-description")).toBeNull();
  });

  // ── shipped ──

  it("shipped: renders trackingNumber", () => {
    renderEvent({
      eventType: "shipped",
      timestamp: BASE_TIMESTAMP,
      metadata: { trackingNumber: "794644823741" },
    });
    expect(screen.getByText("794644823741")).toBeDefined();
  });

  it("shipped: renders origin → destination route when both provided", () => {
    renderEvent({
      eventType: "shipped",
      timestamp: BASE_TIMESTAMP,
      metadata: {
        trackingNumber: "794644823741",
        originName: "Hangar A",
        destinationName: "Site Alpha",
      },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toContain("Hangar A");
    expect(desc.textContent).toContain("Site Alpha");
  });

  it("shipped: renders '→ destination' when originName absent", () => {
    renderEvent({
      eventType: "shipped",
      timestamp: BASE_TIMESTAMP,
      metadata: { trackingNumber: "123", destinationName: "Site Alpha" },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toContain("→ Site Alpha");
  });

  it("shipped: renders nothing when trackingNumber and destinationName both absent", () => {
    renderEvent({
      eventType: "shipped",
      timestamp: BASE_TIMESTAMP,
      metadata: {},
    });
    expect(screen.queryByTestId("timeline-event-description")).toBeNull();
  });

  // ── custody_handoff ──

  it("custody_handoff: renders fromUserName → toUserName", () => {
    renderEvent({
      eventType: "custody_handoff",
      timestamp: BASE_TIMESTAMP,
      metadata: { fromUserName: "Alice Tech", toUserName: "Bob Pilot" },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toContain("Alice Tech");
    expect(desc.textContent).toContain("Bob Pilot");
  });

  it("custody_handoff: renders only toUserName when fromUserName absent", () => {
    renderEvent({
      eventType: "custody_handoff",
      timestamp: BASE_TIMESTAMP,
      metadata: { toUserName: "Bob Pilot" },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toContain("Bob Pilot");
    expect(desc.textContent).not.toContain("→");
  });

  it("custody_handoff: renders nothing when both fromUserName and toUserName absent", () => {
    renderEvent({
      eventType: "custody_handoff",
      timestamp: BASE_TIMESTAMP,
      metadata: {},
    });
    expect(screen.queryByTestId("timeline-event-description")).toBeNull();
  });

  // ── mission_assigned ──

  it("mission_assigned: renders missionName", () => {
    renderEvent({
      eventType: "mission_assigned",
      timestamp: BASE_TIMESTAMP,
      metadata: { missionName: "Site Alpha Deploy" },
    });
    expect(screen.getByText("Site Alpha Deploy")).toBeDefined();
  });

  it("mission_assigned: renders nothing when missionName absent", () => {
    renderEvent({
      eventType: "mission_assigned",
      timestamp: BASE_TIMESTAMP,
      metadata: {},
    });
    expect(screen.queryByTestId("timeline-event-description")).toBeNull();
  });

  // ── template_applied ──

  it("template_applied: renders templateName · itemCount items", () => {
    renderEvent({
      eventType: "template_applied",
      timestamp: BASE_TIMESTAMP,
      metadata: { templateName: "Standard Drone Kit", itemCount: 15 },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toContain("Standard Drone Kit");
    expect(desc.textContent).toContain("15 items");
  });

  it("template_applied: renders only templateName when itemCount absent", () => {
    renderEvent({
      eventType: "template_applied",
      timestamp: BASE_TIMESTAMP,
      metadata: { templateName: "Standard Drone Kit" },
    });
    const desc = screen.getByTestId("timeline-event-description");
    expect(desc.textContent).toBe("Standard Drone Kit");
  });

  it("unknown event types: renders no description block", () => {
    renderEvent({
      eventType: "some_future_event",
      timestamp: BASE_TIMESTAMP,
      metadata: { randomField: "randomValue" },
    });
    expect(screen.queryByTestId("timeline-event-description")).toBeNull();
  });
});

// ─── Location ─────────────────────────────────────────────────────────────────

describe("location", () => {
  it("renders location name when provided in location.locationName", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      location: { lat: 42.36, lng: -71.06, locationName: "Site Alpha" },
      hasCoordinates: true,
    });
    expect(screen.getByTestId("timeline-event-location").textContent).toBe("Site Alpha");
  });

  it("renders coordinates when location.lat and location.lng are present", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      location: { lat: 42.3601, lng: -71.0589 },
      hasCoordinates: true,
    });
    const loc = screen.getByTestId("timeline-event-location");
    expect(loc.textContent).toContain("42.3601");
    expect(loc.textContent).toContain("-71.0589");
  });

  it("prefers locationName over coordinates when both are present", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      location: { lat: 42.36, lng: -71.06, locationName: "Site Alpha" },
      hasCoordinates: true,
    });
    const loc = screen.getByTestId("timeline-event-location");
    expect(loc.textContent).toBe("Site Alpha");
    expect(loc.textContent).not.toContain("42");
  });

  it("renders 'No location recorded' when hasCoordinates=false", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      hasCoordinates: false,
    });
    expect(screen.getByTestId("timeline-event-no-location").textContent).toBe(
      "No location recorded"
    );
  });

  it("renders 'No location recorded' when location prop is absent", () => {
    renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
    });
    expect(screen.getByTestId("timeline-event-no-location").textContent).toBe(
      "No location recorded"
    );
  });
});

// ─── fromStop() static helper ─────────────────────────────────────────────────

describe("TimelineEvent.fromStop()", () => {
  const stop = makeStop({
    eventId:        "evt-42",
    eventType:      "inspection_completed",
    timestamp:      BASE_TIMESTAMP,
    actorName:      "Field Tech",
    metadata:       { totalItems: 10, checkedItems: 10 },
    location:       { lat: 42.36, lng: -71.06, locationName: "Site B" },
    hasCoordinates: true,
  });

  it("sets isFirst=true for index 0", () => {
    const props = TimelineEvent.fromStop(stop, 0, 5);
    expect(props.isFirst).toBe(true);
  });

  it("sets isFirst=false for index > 0", () => {
    const props = TimelineEvent.fromStop(stop, 2, 5);
    expect(props.isFirst).toBe(false);
  });

  it("sets isLast=true for the last index", () => {
    const props = TimelineEvent.fromStop(stop, 4, 5);
    expect(props.isLast).toBe(true);
  });

  it("sets isLast=false when not the last index", () => {
    const props = TimelineEvent.fromStop(stop, 2, 5);
    expect(props.isLast).toBe(false);
  });

  it("sets position.current = index + 1", () => {
    const props = TimelineEvent.fromStop(stop, 2, 5);
    expect(props.position?.current).toBe(3);
  });

  it("sets position.total = total", () => {
    const props = TimelineEvent.fromStop(stop, 2, 5);
    expect(props.position?.total).toBe(5);
  });

  it("copies eventType from JourneyStop", () => {
    const props = TimelineEvent.fromStop(stop, 0, 1);
    expect(props.eventType).toBe("inspection_completed");
  });

  it("copies timestamp from JourneyStop", () => {
    const props = TimelineEvent.fromStop(stop, 0, 1);
    expect(props.timestamp).toBe(BASE_TIMESTAMP);
  });

  it("copies actorName from JourneyStop", () => {
    const props = TimelineEvent.fromStop(stop, 0, 1);
    expect(props.actorName).toBe("Field Tech");
  });

  it("copies metadata from JourneyStop", () => {
    const props = TimelineEvent.fromStop(stop, 0, 1);
    expect(props.metadata).toEqual({ totalItems: 10, checkedItems: 10 });
  });

  it("copies location from JourneyStop", () => {
    const props = TimelineEvent.fromStop(stop, 0, 1);
    expect(props.location?.locationName).toBe("Site B");
  });

  it("copies hasCoordinates from JourneyStop", () => {
    const props = TimelineEvent.fromStop(stop, 0, 1);
    expect(props.hasCoordinates).toBe(true);
  });

  it("renders correctly when using fromStop() props", () => {
    const props = TimelineEvent.fromStop(stop, 0, 1);
    renderEvent(props);
    expect(screen.getByTestId("timeline-event-type").textContent).toBe(
      "Inspection Completed"
    );
    expect(screen.getByTestId("timeline-event-actor").textContent).toBe("Field Tech");
    expect(screen.getByTestId("timeline-event-location").textContent).toBe("Site B");
    // isFirst and isLast at index 0 of 1 total
    const item = screen.getByRole("listitem");
    expect(item.getAttribute("data-is-first")).toBe("true");
    expect(item.getAttribute("data-is-last")).toBe("true");
  });
});

// ─── formatEventType helper ────────────────────────────────────────────────────

describe("formatEventType()", () => {
  it("returns the mapped label for a known event type", () => {
    expect(formatEventType("status_change")).toBe("Status Changed");
    expect(formatEventType("custody_handoff")).toBe("Custody Handoff");
    expect(formatEventType("damage_reported")).toBe("Damage Reported");
    expect(formatEventType("inspection_completed")).toBe("Inspection Completed");
  });

  it("returns Title-Cased label for unknown event type slugs", () => {
    expect(formatEventType("my_custom_event")).toBe("My Custom Event");
    expect(formatEventType("single")).toBe("Single");
    expect(formatEventType("two_words")).toBe("Two Words");
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("accessibility", () => {
  it("timestamp is wrapped in <time> with dateTime attribute", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
    });
    const timeEl = container.querySelector("time");
    expect(timeEl).not.toBeNull();
    expect(timeEl?.getAttribute("dateTime")).toBeTruthy();
  });

  it("spine column is aria-hidden (decorative)", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
    });
    // The .spineCol has aria-hidden="true"
    const spineCol = container.querySelector("[aria-hidden='true']");
    expect(spineCol).not.toBeNull();
  });

  it("metaSep separator is aria-hidden", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      actorName: "Alice",
    });
    // The separator "·" between actor and timestamp should be aria-hidden
    const separators = container.querySelectorAll("[aria-hidden='true']");
    const hasSepWithDot = Array.from(separators).some((el) =>
      el.textContent?.includes("·")
    );
    expect(hasSepWithDot).toBe(true);
  });

  it("event item has aria-label when position is set", () => {
    renderEvent({
      eventType: "shipped",
      timestamp: BASE_TIMESTAMP,
      position: { current: 3, total: 7 },
    });
    const item = screen.getByRole("listitem");
    const label = item.getAttribute("aria-label");
    expect(label).toContain("Event 3 of 7");
    expect(label).toContain("Shipped");
  });

  it("statusArrow in status_change description is aria-hidden", () => {
    const { container } = renderEvent({
      eventType: "status_change",
      timestamp: BASE_TIMESTAMP,
      metadata: { from: "hangar", to: "deployed" },
    });
    const desc = screen.getByTestId("timeline-event-description");
    const ariaHiddenInDesc = within(desc).getAllByText("→");
    // Arrow text exists; check it's aria-hidden
    const allAriaHidden = Array.from(
      container.querySelectorAll("[aria-hidden='true']")
    );
    const arrowHidden = allAriaHidden.some((el) => el.textContent === "→");
    expect(arrowHidden).toBe(true);
  });
});
