/**
 * @vitest-environment jsdom
 *
 * TrackingStatus.events.test.tsx
 *
 * Unit tests for the event history list section of TrackingStatus.
 *
 * Sub-AC 3 of AC 380203: "Build the event history list section of
 * TrackingStatus, rendering a chronological timeline of tracking events
 * with timestamp, location, and description for each entry."
 *
 * The component is tested in CONTROLLED mode — props are passed directly
 * rather than relying on Convex subscriptions.  This isolates the rendering
 * logic from the data-fetching layer so tests run fast and deterministically.
 *
 * Coverage matrix
 * ───────────────
 *
 * Event history section — presence and structure:
 *   ✓ full variant renders events section when liveTracking has events
 *   ✓ full variant does not render events section when events array is empty
 *   ✓ full variant does not render events section when liveTracking is null
 *   ✓ compact variant never renders the events timeline
 *
 * Event list container:
 *   ✓ events list is an ordered list (<ol>)
 *   ✓ events list has accessible aria-label
 *   ✓ events section heading is "Tracking Events"
 *
 * Per-event rendering — description:
 *   ✓ renders event description text
 *   ✓ falls back to eventType when description is empty string
 *
 * Per-event rendering — timestamp:
 *   ✓ renders <time> element for each event with ISO dateTime attribute
 *   ✓ time element shows human-readable formatted timestamp (non-empty)
 *   ✓ event with empty timestamp string still renders without crashing
 *
 * Per-event rendering — location:
 *   ✓ renders city, state, country joined by ", " in the timeline location span
 *   ✓ renders location with only city (state and country absent)
 *   ✓ renders location with only state
 *   ✓ renders location with only country
 *   ✓ does not render location span when all location fields are absent
 *
 * Timeline structure (visual spine):
 *   ✓ each event list item has a decorative dot element (aria-hidden="true")
 *   ✓ renders one list item per event
 *
 * Live badge:
 *   ✓ "Live" badge appears in events header when liveTracking is non-null
 *   ✓ no events section when liveTracking is null
 *
 * Multiple events:
 *   ✓ renders all events in the list (correct count)
 *   ✓ events render in the order provided (caller controls ordering)
 *
 * React key stability:
 *   ✓ events with duplicate timestamps don't crash (index used as key tiebreaker)
 *
 * No-tracking / no-shipment empty state:
 *   ✓ renders "No shipment recorded" heading when shipment prop is null
 *   ✓ no events list in no-shipment state
 *
 * Accessibility:
 *   ✓ events section has an accessible label (aria-label on section element)
 *   ✓ time elements have a valid ISO dateTime attribute
 *   ✓ timeline dots are aria-hidden (decorative)
 */

import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi, beforeAll } from "vitest";

// ─── Module-level mocks (hoisted before imports) ──────────────────────────────

// Mock convex/react so no ConvexProvider is required during rendering.
// Controlled mode does not call any Convex hooks, but the module import
// chain requires convex/react to be resolvable.
vi.mock("convex/react", () => ({
  useQuery:  vi.fn(() => undefined),
  useAction: vi.fn(() => vi.fn()),
}));

// Mock the generated Convex API (avoids missing-module errors from the API
// barrel file that the hook module imports).
vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    shipping: {
      listShipmentsByCase: "shipping:listShipmentsByCase",
      trackShipment:       "shipping:trackShipment",
    },
  },
}));

// Mock the fedex-tracking hook.
// Controlled mode does not invoke useFedExTracking, but the module must
// still be importable without errors.
vi.mock("../../../hooks/use-fedex-tracking", () => ({
  useFedExTracking: vi.fn(() => ({
    shipments:           [],
    latestShipment:      null,
    hasTracking:         false,
    isActiveShipment:    false,
    liveTracking:        null,
    isRefreshing:        false,
    refreshError:        null,
    refreshErrorCode:    null,
    refreshErrorMessage: null,
    refreshTracking:     vi.fn(),
  })),
}));

// Import the component AFTER vi.mock declarations (Vitest hoists vi.mock calls).
import { TrackingStatus } from "../TrackingStatus";
import type {
  TrackingStatusControlledProps,
} from "../TrackingStatus";
import type {
  ShipmentRecord,
  LiveTrackingResult,
  TrackingEvent,
} from "../../../hooks/use-fedex-tracking";

// ─── Suppress CSS module in jsdom ─────────────────────────────────────────────
beforeAll(() => {
  // No-op: CSS modules return empty objects in jsdom; no additional setup needed.
});

// ─── Cleanup after each test ──────────────────────────────────────────────────
afterEach(() => {
  cleanup();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A minimal valid ShipmentRecord for controlled mode. */
const BASE_SHIPMENT: ShipmentRecord = {
  _id:            "shipment_001",
  _creationTime:  1_700_000_000_000,
  caseId:         "case_001",
  trackingNumber: "794644823741",
  carrier:        "FedEx",
  status:         "in_transit",
  createdAt:      1_700_000_000_000,
  updatedAt:      1_700_010_000_000,
};

/**
 * Build a TrackingEvent fixture.
 * Defaults to a full location; use overrides to test partial/missing fields.
 */
function makeEvent(overrides: Partial<TrackingEvent> = {}): TrackingEvent {
  return {
    timestamp:   "2024-03-15T14:30:00.000Z",
    eventType:   "PU",
    description: "Package picked up",
    location: {
      city:    "Memphis",
      state:   "TN",
      country: "US",
    },
    ...overrides,
  };
}

/**
 * Build a LiveTrackingResult with a specified set of events.
 */
function makeLiveTracking(
  events: TrackingEvent[],
  overrides: Partial<LiveTrackingResult> = {}
): LiveTrackingResult {
  return {
    trackingNumber: "794644823741",
    status:         "in_transit",
    description:    "Package in transit",
    events,
    ...overrides,
  };
}

/**
 * Build the full set of controlled props for TrackingStatus.
 */
function makeControlledProps(
  overrides: Partial<TrackingStatusControlledProps> = {}
): TrackingStatusControlledProps {
  return {
    caseId:           "case_001",
    variant:          "full",
    shipment:         BASE_SHIPMENT,
    liveTracking:     null,
    isRefreshing:     false,
    isActiveShipment: true,
    refreshError:     null,
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Render TrackingStatus in controlled mode with the given props and return
 * the container element.
 */
function renderControlled(props: Partial<TrackingStatusControlledProps> = {}) {
  const fullProps = makeControlledProps(props);
  const { container } = render(<TrackingStatus {...fullProps} />);
  return container;
}

/**
 * Get the events timeline <ol> element.
 * Returns null when the timeline is not rendered.
 */
function queryEventsList(): HTMLElement | null {
  return screen.queryByRole("list", { name: /shipment scan events/i });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TrackingStatus — event history list section (Sub-AC 3)", () => {

  // ── Section presence ────────────────────────────────────────────────────────

  describe("event history section — presence and structure", () => {
    it("full variant renders the events section when liveTracking has events", () => {
      const events = [makeEvent()];
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking(events),
      });

      // The section element (aria-label="FedEx tracking events") must exist
      expect(
        screen.getByRole("region", { name: /fedex tracking events/i })
      ).toBeDefined();
    });

    it("full variant does not render events section when events array is empty", () => {
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([]),
      });

      // No events region should exist when events is empty
      expect(
        screen.queryByRole("region", { name: /fedex tracking events/i })
      ).toBeNull();
    });

    it("full variant does not render events section when liveTracking is null", () => {
      renderControlled({
        variant:      "full",
        liveTracking: null,
      });

      expect(
        screen.queryByRole("region", { name: /fedex tracking events/i })
      ).toBeNull();
    });

    it("compact variant never renders the events timeline", () => {
      const events = [makeEvent(), makeEvent({ description: "In transit" })];
      renderControlled({
        variant:      "compact",
        liveTracking: makeLiveTracking(events),
      });

      // Compact mode must not show the tracking events section
      expect(queryEventsList()).toBeNull();
      expect(
        screen.queryByRole("region", { name: /fedex tracking events/i })
      ).toBeNull();
    });
  });

  // ── Event list container ─────────────────────────────────────────────────────

  describe("events list container", () => {
    it("events list is an ordered list (<ol>)", () => {
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([makeEvent()]),
      });

      // The list must be an <ol> (temporal order is semantically significant)
      const list = queryEventsList();
      expect(list).not.toBeNull();
      expect(list!.tagName).toBe("OL");
    });

    it("events list has an accessible aria-label", () => {
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([makeEvent()]),
      });

      const list = screen.getByRole("list", { name: /shipment scan events/i });
      expect(list).toBeDefined();
    });

    it("events section heading contains 'Tracking Events'", () => {
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([makeEvent()]),
      });

      const heading = screen.getByText("Tracking Events");
      expect(heading).toBeDefined();
    });
  });

  // ── Per-event description ────────────────────────────────────────────────────

  describe("per-event rendering — description", () => {
    it("renders event description text", () => {
      const event = makeEvent({ description: "Package picked up at origin facility" });
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([event]),
      });

      const descEl = screen.getByText("Package picked up at origin facility");
      expect(descEl).toBeDefined();
    });

    it("falls back to eventType when description is empty string", () => {
      const event = makeEvent({ description: "", eventType: "FX_PU_CODE" });
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([event]),
      });

      // When description is empty, eventType should be shown
      const fallback = screen.getByText("FX_PU_CODE");
      expect(fallback).toBeDefined();
    });
  });

  // ── Per-event timestamp ──────────────────────────────────────────────────────

  describe("per-event rendering — timestamp", () => {
    it("renders a <time> element with ISO dateTime attribute", () => {
      const isoTimestamp = "2024-03-15T14:30:00.000Z";
      const event = makeEvent({ timestamp: isoTimestamp });
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([event]),
      });

      const timeEl = screen.getByRole("time");
      expect(timeEl).toBeDefined();
      // The dateTime attribute must hold the original ISO string
      expect(timeEl.getAttribute("dateTime")).toBe(isoTimestamp);
    });

    it("time element shows a non-empty human-readable timestamp string", () => {
      const isoTimestamp = "2024-03-15T14:30:00.000Z";
      const event = makeEvent({ timestamp: isoTimestamp });
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([event]),
      });

      const timeEl = screen.getByRole("time");
      expect(timeEl.textContent!.trim().length).toBeGreaterThan(0);
    });

    it("event with empty timestamp string still renders without crashing", () => {
      const event = makeEvent({ timestamp: "" });
      expect(() => {
        renderControlled({
          variant:      "full",
          liveTracking: makeLiveTracking([event]),
        });
      }).not.toThrow();
    });
  });

  // ── Per-event location ──────────────────────────────────────────────────────

  describe("per-event rendering — location", () => {
    it("renders city, state, country joined by ', ' in the timeline location span", () => {
      const event = makeEvent({
        // Provide unique descriptions to avoid matching the TrackingInfo chip
        description: "Unique event for location test",
        location: { city: "Portland", state: "OR", country: "US" },
      });
      renderControlled({
        variant:      "full",
        // No ETA or current location in shipment so no locationChip
        shipment: { ...BASE_SHIPMENT, estimatedDelivery: undefined },
        liveTracking: makeLiveTracking([event]),
      });

      // The timelineLoc span must contain the formatted location string
      const section = screen.getByRole("region", { name: /fedex tracking events/i });
      const locSpan = within(section).getByText("Portland, OR, US");
      expect(locSpan).toBeDefined();
    });

    it("renders location with only city when state and country are absent", () => {
      const event = makeEvent({
        description: "Only city location test",
        location: { city: "Anchorage", state: undefined, country: undefined },
      });
      renderControlled({
        variant:      "full",
        shipment: { ...BASE_SHIPMENT, estimatedDelivery: undefined },
        liveTracking: makeLiveTracking([event]),
      });

      const section = screen.getByRole("region", { name: /fedex tracking events/i });
      const locSpan = within(section).getByText("Anchorage");
      expect(locSpan).toBeDefined();
    });

    it("renders location with only state", () => {
      const event = makeEvent({
        description: "Only state location test",
        location: { city: undefined, state: "TX", country: undefined },
      });
      renderControlled({
        variant:      "full",
        shipment: { ...BASE_SHIPMENT, estimatedDelivery: undefined },
        liveTracking: makeLiveTracking([event]),
      });

      const section = screen.getByRole("region", { name: /fedex tracking events/i });
      const locSpan = within(section).getByText("TX");
      expect(locSpan).toBeDefined();
    });

    it("renders location with only country", () => {
      const event = makeEvent({
        description: "Only country location test",
        location: { city: undefined, state: undefined, country: "CA" },
      });
      renderControlled({
        variant:      "full",
        shipment: { ...BASE_SHIPMENT, estimatedDelivery: undefined },
        liveTracking: makeLiveTracking([event]),
      });

      const section = screen.getByRole("region", { name: /fedex tracking events/i });
      const locSpan = within(section).getByText("CA");
      expect(locSpan).toBeDefined();
    });

    it("does not render a location span when all location fields are absent", () => {
      const event = makeEvent({
        description: "No location event",
        location: { city: undefined, state: undefined, country: undefined },
      });
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([event]),
      });

      const section = screen.getByRole("region", { name: /fedex tracking events/i });
      // The timelineLoc span (aria-label="Location: ...") must not be present
      expect(
        within(section).queryByRole("generic", { name: /location:/i })
      ).toBeNull();
      // No element should have a label starting with "Location:"
      const allWithLocation = within(section).queryAllByText(/Location:/i);
      expect(allWithLocation).toHaveLength(0);
    });
  });

  // ── Timeline visual structure ────────────────────────────────────────────────

  describe("timeline visual structure", () => {
    it("each event list item contains a decorative dot (aria-hidden='true')", () => {
      const events = [makeEvent(), makeEvent({ description: "Second event" })];
      const { container } = render(
        <TrackingStatus {...makeControlledProps({
          variant:      "full",
          liveTracking: makeLiveTracking(events),
        })} />
      );

      // Each timeline item has a dot div with aria-hidden="true"
      // (The timeline renders at least 2 dots for 2 events)
      const hiddenDots = container.querySelectorAll(
        '[aria-hidden="true"]'
      );
      // There must be at least 2 hidden elements (one dot per event)
      expect(hiddenDots.length).toBeGreaterThanOrEqual(2);
    });

    it("renders one list item per event", () => {
      const events = [
        makeEvent({ description: "Picked up" }),
        makeEvent({ description: "At hub" }),
        makeEvent({ description: "Out for delivery" }),
      ];
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking(events),
      });

      const list = queryEventsList();
      expect(list).not.toBeNull();
      const items = within(list!).getAllByRole("listitem");
      expect(items).toHaveLength(3);
    });
  });

  // ── Live badge ───────────────────────────────────────────────────────────────

  describe("live badge in events section header", () => {
    it("'Live' label appears in events section when liveTracking is non-null", () => {
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([makeEvent()]),
      });

      const section = screen.getByRole("region", { name: /fedex tracking events/i });
      // The events section header should contain a "Live" badge
      const liveBadges = within(section).getAllByText(/^live$/i);
      expect(liveBadges.length).toBeGreaterThanOrEqual(1);
    });

    it("no events section is rendered when liveTracking is null (no live badge)", () => {
      renderControlled({
        variant:      "full",
        liveTracking: null,
      });

      // When liveTracking is null, events section doesn't render at all
      expect(
        screen.queryByRole("region", { name: /fedex tracking events/i })
      ).toBeNull();
    });
  });

  // ── Multiple events ──────────────────────────────────────────────────────────

  describe("multiple events", () => {
    it("renders all events in the list matching the count provided", () => {
      const events = [
        makeEvent({ description: "Label created" }),
        makeEvent({ description: "Picked up" }),
        makeEvent({ description: "At hub" }),
        makeEvent({ description: "Out for delivery" }),
        makeEvent({ description: "Delivered" }),
      ];
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking(events),
      });

      const list = queryEventsList();
      expect(list).not.toBeNull();
      const items = within(list!).getAllByRole("listitem");
      expect(items).toHaveLength(5);
    });

    it("renders events in the order provided by the caller", () => {
      const events = [
        makeEvent({ description: "Alpha event" }),
        makeEvent({ description: "Beta event" }),
        makeEvent({ description: "Gamma event" }),
      ];
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking(events),
      });

      const list = queryEventsList();
      expect(list).not.toBeNull();
      const items = within(list!).getAllByRole("listitem");
      expect(items[0].textContent).toContain("Alpha event");
      expect(items[1].textContent).toContain("Beta event");
      expect(items[2].textContent).toContain("Gamma event");
    });
  });

  // ── React key stability ──────────────────────────────────────────────────────

  describe("React key stability", () => {
    it("renders without crashing when multiple events share the same timestamp", () => {
      const sharedTs = "2024-03-15T10:00:00.000Z";
      const events = [
        makeEvent({ timestamp: sharedTs, description: "First duplicate" }),
        makeEvent({ timestamp: sharedTs, description: "Second duplicate" }),
        makeEvent({ timestamp: sharedTs, description: "Third duplicate" }),
      ];
      // Index is used as tiebreaker in the key — no duplicate key warning
      expect(() => {
        renderControlled({
          variant:      "full",
          liveTracking: makeLiveTracking(events),
        });
      }).not.toThrow();

      const list = queryEventsList();
      expect(list).not.toBeNull();
      expect(within(list!).getAllByRole("listitem")).toHaveLength(3);
    });
  });

  // ── No-shipment / no-tracking empty state ────────────────────────────────────

  describe("no-shipment state", () => {
    it("renders 'No shipment recorded' message when shipment prop is null", () => {
      render(
        <TrackingStatus
          caseId="case_001"
          variant="full"
          shipment={null}
        />
      );

      // The NoTracking component should be rendered
      expect(screen.getByText(/no shipment recorded/i)).toBeDefined();
    });

    it("does not render the events list in the no-shipment state", () => {
      render(
        <TrackingStatus
          caseId="case_001"
          variant="full"
          shipment={null}
        />
      );

      expect(queryEventsList()).toBeNull();
      expect(
        screen.queryByRole("region", { name: /fedex tracking events/i })
      ).toBeNull();
    });
  });

  // ── Accessibility ────────────────────────────────────────────────────────────

  describe("accessibility", () => {
    it("events section is a <section> element with aria-label (role='region')", () => {
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([makeEvent()]),
      });

      // <section aria-label="FedEx tracking events"> maps to role="region"
      const region = screen.getByRole("region", { name: /fedex tracking events/i });
      expect(region.tagName).toBe("SECTION");
    });

    it("<time> elements have a valid ISO 8601 dateTime attribute", () => {
      const isoTimestamp = "2024-06-01T09:15:30.000Z";
      renderControlled({
        variant:      "full",
        liveTracking: makeLiveTracking([makeEvent({ timestamp: isoTimestamp })]),
      });

      const timeEl = screen.getByRole("time");
      const dt = timeEl.getAttribute("dateTime");
      expect(dt).not.toBeNull();
      // A valid ISO 8601 string must parse to a valid date
      expect(Number.isNaN(Date.parse(dt!))).toBe(false);
    });

    it("timeline dot elements are aria-hidden (not read by screen readers)", () => {
      const { container } = render(
        <TrackingStatus {...makeControlledProps({
          variant:      "full",
          liveTracking: makeLiveTracking([makeEvent()]),
        })} />
      );

      // At least one aria-hidden element must exist as a decorative dot
      const hiddenEls = container.querySelectorAll('[aria-hidden="true"]');
      expect(hiddenEls.length).toBeGreaterThan(0);
    });
  });
});
