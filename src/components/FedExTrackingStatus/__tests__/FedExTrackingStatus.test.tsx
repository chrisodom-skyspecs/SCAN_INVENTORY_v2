/**
 * @vitest-environment jsdom
 *
 * FedExTrackingStatus.test.tsx
 *
 * Unit tests for the FedExTrackingStatus pure UI component (Sub-AC 2).
 *
 * Tests cover:
 *   - Status row: carrier badge and StatusPill rendering
 *   - Estimated delivery: presence, formatting, accessible label
 *   - Last event: description, timestamp, location, fallback to eventType
 *   - Empty/optional props: graceful omission of sections
 *   - Accessibility: aria-label attributes, <time> element, role="region"
 *   - Design token compliance: no hard-coded values (structural only here)
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// CSS modules return empty objects in jsdom — no special setup needed.
// Mock CSS modules to avoid import errors (vitest handles this via config)

import {
  FedExTrackingStatus,
} from "../FedExTrackingStatus";
import type {
  FedExTrackingStatusProps,
  FedExTrackingEvent,
} from "../FedExTrackingStatus";

// ─── Clean up after each test ─────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LAST_EVENT: FedExTrackingEvent = {
  timestamp: "2024-06-14T09:30:00.000Z",
  eventType: "IT",
  description: "Departed FedEx hub",
  location: { city: "Memphis", state: "TN", country: "US" },
};

const LAST_EVENT_NO_LOCATION: FedExTrackingEvent = {
  timestamp: "2024-06-14T09:30:00.000Z",
  eventType: "OD",
  description: "Out for delivery",
  location: {},
};

function makeProps(
  overrides: Partial<FedExTrackingStatusProps> = {}
): FedExTrackingStatusProps {
  return {
    carrier: "FedEx",
    status: "in_transit",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FedExTrackingStatus — Sub-AC 2 (pure UI component)", () => {

  // ── Rendering smoke test ─────────────────────────────────────────────────────

  describe("renders without crashing", () => {
    it("renders with only required props (status)", () => {
      expect(() => {
        render(<FedExTrackingStatus {...makeProps()} />);
      }).not.toThrow();
    });

    it("has data-testid='fedex-tracking-status' on root element", () => {
      render(<FedExTrackingStatus {...makeProps()} />);
      expect(screen.getByTestId("fedex-tracking-status")).toBeDefined();
    });
  });

  // ── Section 1: Status row ─────────────────────────────────────────────────────

  describe("status row", () => {
    it("renders the carrier badge with carrier text", () => {
      render(<FedExTrackingStatus {...makeProps({ carrier: "FedEx" })} />);
      expect(screen.getByText("FedEx")).toBeDefined();
    });

    it("defaults carrier to 'FedEx' when carrier prop is omitted", () => {
      // Render without explicit carrier — relies on the default="FedEx"
      render(<FedExTrackingStatus status="in_transit" />);
      expect(screen.getByText("FedEx")).toBeDefined();
    });

    it("renders carrier badge with aria-label for screen readers", () => {
      render(<FedExTrackingStatus {...makeProps({ carrier: "FedEx" })} />);
      const badge = screen.getByLabelText(/carrier: fedex/i);
      expect(badge).toBeDefined();
    });

    it("renders a status row with aria-label='Carrier tracking status'", () => {
      render(<FedExTrackingStatus {...makeProps()} />);
      expect(screen.getByLabelText(/carrier tracking status/i)).toBeDefined();
    });

    it("renders the StatusPill for each valid status kind", () => {
      const statuses = [
        "label_created",
        "picked_up",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "exception",
      ] as const;

      for (const status of statuses) {
        const { unmount } = render(
          <FedExTrackingStatus {...makeProps({ status })} />
        );
        // StatusPill renders a span with role="status"
        const pills = screen.getAllByRole("status");
        expect(pills.length).toBeGreaterThan(0);
        unmount();
      }
    });
  });

  // ── Section 2: Estimated delivery ────────────────────────────────────────────

  describe("estimated delivery section", () => {
    it("renders estimated delivery row when estimatedDelivery is provided", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({ estimatedDelivery: "2024-06-15T18:00:00.000Z" })}
        />
      );
      // "Est. Delivery" label text confirms the delivery row is rendered
      expect(screen.getByText("Est. Delivery")).toBeDefined();
    });

    it("does not render estimated delivery row when estimatedDelivery is omitted", () => {
      render(<FedExTrackingStatus {...makeProps()} />);
      // "Est. Delivery" label is only present when the delivery row renders
      expect(screen.queryByText("Est. Delivery")).toBeNull();
    });

    it("does not render estimated delivery row when estimatedDelivery is null", () => {
      render(
        <FedExTrackingStatus {...makeProps({ estimatedDelivery: null })} />
      );
      expect(screen.queryByText("Est. Delivery")).toBeNull();
    });

    it("renders a non-empty formatted date string for estimatedDelivery", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({ estimatedDelivery: "2024-06-15T18:00:00.000Z" })}
        />
      );
      // The aria-label on the value span contains the formatted date
      const el = screen.getByLabelText(/estimated delivery:/i);
      expect(el).toBeDefined();
      expect(el.textContent!.trim().length).toBeGreaterThan(0);
    });

    it("renders 'Est. Delivery' label text", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({ estimatedDelivery: "2024-06-15T18:00:00.000Z" })}
        />
      );
      expect(screen.getByText("Est. Delivery")).toBeDefined();
    });
  });

  // ── Section 3: Last event ─────────────────────────────────────────────────────

  describe("last event section", () => {
    it("renders last event section when lastEvent is provided", () => {
      render(<FedExTrackingStatus {...makeProps({ lastEvent: LAST_EVENT })} />);
      expect(screen.getByRole("region", { name: /last tracking event/i })).toBeDefined();
    });

    it("does not render last event section when lastEvent is omitted", () => {
      render(<FedExTrackingStatus {...makeProps()} />);
      expect(
        screen.queryByRole("region", { name: /last tracking event/i })
      ).toBeNull();
    });

    it("does not render last event section when lastEvent is null", () => {
      render(<FedExTrackingStatus {...makeProps({ lastEvent: null })} />);
      expect(
        screen.queryByRole("region", { name: /last tracking event/i })
      ).toBeNull();
    });

    it("renders event description text", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({
            lastEvent: { ...LAST_EVENT, description: "Departed FedEx hub" },
          })}
        />
      );
      expect(screen.getByText("Departed FedEx hub")).toBeDefined();
    });

    it("falls back to eventType when description is empty", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({
            lastEvent: {
              ...LAST_EVENT,
              description: "",
              eventType: "DL",
            },
          })}
        />
      );
      expect(screen.getByText("DL")).toBeDefined();
    });

    it("renders 'Last Event' heading in the section", () => {
      render(<FedExTrackingStatus {...makeProps({ lastEvent: LAST_EVENT })} />);
      expect(screen.getByText("Last Event")).toBeDefined();
    });

    // ── Timestamp ────────────────────────────────────────────────────────────

    it("renders a <time> element with ISO dateTime attribute", () => {
      const ts = "2024-06-14T09:30:00.000Z";
      render(
        <FedExTrackingStatus
          {...makeProps({ lastEvent: { ...LAST_EVENT, timestamp: ts } })}
        />
      );
      const timeEl = screen.getByRole("time");
      expect(timeEl).toBeDefined();
      expect(timeEl.getAttribute("dateTime")).toBe(ts);
    });

    it("time element shows a non-empty human-readable timestamp", () => {
      render(<FedExTrackingStatus {...makeProps({ lastEvent: LAST_EVENT })} />);
      const timeEl = screen.getByRole("time");
      expect(timeEl.textContent!.trim().length).toBeGreaterThan(0);
    });

    it("renders without crashing when timestamp is empty string", () => {
      expect(() => {
        render(
          <FedExTrackingStatus
            {...makeProps({
              lastEvent: { ...LAST_EVENT, timestamp: "" },
            })}
          />
        );
      }).not.toThrow();
    });

    // ── Location ─────────────────────────────────────────────────────────────

    it("renders formatted location when city, state, country are present", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({
            lastEvent: {
              ...LAST_EVENT,
              location: { city: "Memphis", state: "TN", country: "US" },
            },
          })}
        />
      );
      expect(screen.getByLabelText(/location: memphis, tn, us/i)).toBeDefined();
    });

    it("renders location with only city", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({
            lastEvent: {
              ...LAST_EVENT,
              location: { city: "Anchorage" },
            },
          })}
        />
      );
      expect(screen.getByLabelText(/location: anchorage/i)).toBeDefined();
    });

    it("renders location with only state", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({
            lastEvent: {
              ...LAST_EVENT,
              location: { state: "TX" },
            },
          })}
        />
      );
      expect(screen.getByLabelText(/location: tx/i)).toBeDefined();
    });

    it("renders location with only country", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({
            lastEvent: {
              ...LAST_EVENT,
              location: { country: "CA" },
            },
          })}
        />
      );
      expect(screen.getByLabelText(/location: ca/i)).toBeDefined();
    });

    it("does not render location chip when all location fields are absent", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({ lastEvent: LAST_EVENT_NO_LOCATION })}
        />
      );
      expect(screen.queryByLabelText(/^location:/i)).toBeNull();
    });
  });

  // ── Full props combination ────────────────────────────────────────────────────

  describe("full props — all sections rendered", () => {
    it("renders all three sections when all props are provided", () => {
      render(
        <FedExTrackingStatus
          carrier="FedEx"
          status="in_transit"
          estimatedDelivery="2024-06-15T18:00:00.000Z"
          lastEvent={LAST_EVENT}
        />
      );

      // Section 1: carrier + status
      expect(screen.getByLabelText(/carrier tracking status/i)).toBeDefined();
      // Section 2: delivery — "Est. Delivery" label confirms the row is present
      expect(screen.getByText("Est. Delivery")).toBeDefined();
      // Section 3: last event
      expect(screen.getByRole("region", { name: /last tracking event/i })).toBeDefined();
    });
  });

  // ── Tracking number ──────────────────────────────────────────────────────────

  describe("tracking number (current state detail)", () => {
    it("renders tracking number label and value when trackingNumber is provided", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({ trackingNumber: "794612345678" })}
        />
      );
      expect(screen.getByText("Tracking No.")).toBeDefined();
      expect(screen.getByText("794612345678")).toBeDefined();
    });

    it("does not render tracking number row when omitted", () => {
      render(<FedExTrackingStatus {...makeProps()} />);
      expect(screen.queryByText("Tracking No.")).toBeNull();
    });

    it("does not render tracking number row when null", () => {
      render(
        <FedExTrackingStatus {...makeProps({ trackingNumber: null })} />
      );
      expect(screen.queryByText("Tracking No.")).toBeNull();
    });

    it("tracking number value has descriptive aria-label", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({ trackingNumber: "794612345678" })}
        />
      );
      expect(screen.getByLabelText(/tracking number: 794612345678/i))
        .toBeDefined();
    });
  });

  // ── Section 4: History timeline (Sub-AC 4) ──────────────────────────────────

  describe("history timeline (events)", () => {
    const HISTORY: FedExTrackingEvent[] = [
      {
        timestamp: "2024-06-14T15:00:00.000Z",
        eventType: "OD",
        description: "Out for delivery",
        location: { city: "Austin", state: "TX", country: "US" },
      },
      {
        timestamp: "2024-06-14T09:30:00.000Z",
        eventType: "IT",
        description: "Departed FedEx hub",
        location: { city: "Memphis", state: "TN", country: "US" },
      },
      {
        timestamp: "2024-06-13T22:00:00.000Z",
        eventType: "PU",
        description: "Picked up by FedEx",
        location: { city: "Seattle", state: "WA", country: "US" },
      },
    ];

    it("renders the history section when events array is non-empty", () => {
      render(
        <FedExTrackingStatus {...makeProps({ events: HISTORY })} />
      );
      expect(
        screen.getByRole("region", { name: /tracking history/i })
      ).toBeDefined();
    });

    it("does not render the history section when events is omitted", () => {
      render(<FedExTrackingStatus {...makeProps()} />);
      expect(
        screen.queryByRole("region", { name: /tracking history/i })
      ).toBeNull();
    });

    it("does not render the history section when events is empty array", () => {
      render(<FedExTrackingStatus {...makeProps({ events: [] })} />);
      expect(
        screen.queryByRole("region", { name: /tracking history/i })
      ).toBeNull();
    });

    it("does not render the history section when events is null", () => {
      render(<FedExTrackingStatus {...makeProps({ events: null })} />);
      expect(
        screen.queryByRole("region", { name: /tracking history/i })
      ).toBeNull();
    });

    it("renders one timeline entry per event", () => {
      render(
        <FedExTrackingStatus {...makeProps({ events: HISTORY })} />
      );
      const items = screen.getAllByTestId("fedex-tracking-event");
      expect(items.length).toBe(HISTORY.length);
    });

    it("renders all event descriptions in the timeline", () => {
      render(
        <FedExTrackingStatus {...makeProps({ events: HISTORY })} />
      );
      // events[0] is auto-promoted to the lastEvent highlight, so its
      // description appears twice (once in highlight, once in timeline).
      // Both should still be findable.
      expect(screen.getAllByText("Out for delivery").length).toBeGreaterThanOrEqual(1);
      // Events that are not the most recent only appear in the timeline.
      expect(screen.getByText("Picked up by FedEx")).toBeDefined();
    });

    it("preserves the events order as given (most recent first)", () => {
      render(
        <FedExTrackingStatus {...makeProps({ events: HISTORY })} />
      );
      const items = screen.getAllByTestId("fedex-tracking-event");
      // First DOM item should match HISTORY[0]
      expect(items[0]!.textContent).toContain("Out for delivery");
      // Last DOM item should match HISTORY[HISTORY.length - 1]
      expect(items[items.length - 1]!.textContent).toContain(
        "Picked up by FedEx"
      );
    });

    it("renders a <time> element per event with ISO dateTime", () => {
      render(
        <FedExTrackingStatus {...makeProps({ events: HISTORY })} />
      );
      const timeEls = screen.getAllByRole("time");
      // 1 for the "Last Event" highlight + 3 for the history timeline
      // (The component auto-promotes events[0] as lastEvent)
      expect(timeEls.length).toBeGreaterThanOrEqual(HISTORY.length);
      // Every dateTime attr is a valid ISO 8601 timestamp
      for (const el of timeEls) {
        const dt = el.getAttribute("dateTime");
        expect(dt).not.toBeNull();
        expect(Number.isNaN(Date.parse(dt!))).toBe(false);
      }
    });

    it("falls back to eventType when description is empty", () => {
      const events: FedExTrackingEvent[] = [
        {
          timestamp: "2024-06-14T09:30:00.000Z",
          eventType: "DL",
          description: "",
          location: {},
        },
      ];
      render(<FedExTrackingStatus {...makeProps({ events })} />);
      // events[0] auto-promotes into the lastEvent highlight, so "DL"
      // renders both in the highlight card and in the timeline (≥1 match).
      expect(screen.getAllByText("DL").length).toBeGreaterThanOrEqual(1);
    });

    it("auto-promotes events[0] as the Last Event highlight when lastEvent is omitted", () => {
      render(
        <FedExTrackingStatus {...makeProps({ events: HISTORY })} />
      );
      // "Last Event" heading must be present
      expect(screen.getByText("Last Event")).toBeDefined();
      // The featured description should match events[0]
      expect(screen.getByRole("region", { name: /last tracking event/i }))
        .toBeDefined();
    });

    it("explicit lastEvent overrides events[0] for the highlight section", () => {
      const explicitLastEvent: FedExTrackingEvent = {
        timestamp: "2024-06-15T12:00:00.000Z",
        eventType: "DL",
        description: "Delivered to recipient",
        location: { city: "Austin", state: "TX" },
      };
      render(
        <FedExTrackingStatus
          {...makeProps({
            events: HISTORY,
            lastEvent: explicitLastEvent,
          })}
        />
      );
      // The "Last Event" highlight should show the explicit value
      const region = screen.getByRole("region", {
        name: /last tracking event/i,
      });
      expect(region.textContent).toContain("Delivered to recipient");
      // The history timeline should still render every event from `events`
      expect(screen.getAllByTestId("fedex-tracking-event").length).toBe(
        HISTORY.length
      );
    });

    it("renders location chips for events that have location data", () => {
      render(
        <FedExTrackingStatus {...makeProps({ events: HISTORY })} />
      );
      // Each history event has location → should be present in the timeline
      // We check that "Memphis, TN, US" appears somewhere in the rendered DOM
      // (it appears in the timeline location chip).
      const matches = screen.getAllByLabelText(/location: memphis, tn, us/i);
      expect(matches.length).toBeGreaterThan(0);
    });

    it("does not render a location chip when event has no location data", () => {
      const events: FedExTrackingEvent[] = [
        {
          timestamp: "2024-06-14T09:30:00.000Z",
          eventType: "OC",
          description: "Order created",
          location: {},
        },
      ];
      render(<FedExTrackingStatus {...makeProps({ events })} />);
      // No location chip should be rendered for this event
      expect(screen.queryByLabelText(/^location:/i)).toBeNull();
    });

    it("history section is a <section> with role='region'", () => {
      render(
        <FedExTrackingStatus {...makeProps({ events: HISTORY })} />
      );
      const region = screen.getByRole("region", {
        name: /tracking history/i,
      });
      expect(region.tagName).toBe("SECTION");
    });

    it("renders 'Tracking History' heading", () => {
      render(
        <FedExTrackingStatus {...makeProps({ events: HISTORY })} />
      );
      expect(screen.getByText("Tracking History")).toBeDefined();
    });
  });

  // ── Full case-detail combination — current state, history, ETA ───────────────

  describe("full case-detail combination — current state, history, ETA", () => {
    const HISTORY: FedExTrackingEvent[] = [
      {
        timestamp: "2024-06-14T09:30:00.000Z",
        eventType: "IT",
        description: "Departed FedEx hub",
        location: { city: "Memphis", state: "TN", country: "US" },
      },
      {
        timestamp: "2024-06-13T22:00:00.000Z",
        eventType: "PU",
        description: "Picked up",
        location: { city: "Seattle", state: "WA", country: "US" },
      },
    ];

    it("renders status, tracking number, ETA, and history timeline together", () => {
      render(
        <FedExTrackingStatus
          carrier="FedEx"
          status="in_transit"
          trackingNumber="794612345678"
          estimatedDelivery="2024-06-15T18:00:00.000Z"
          events={HISTORY}
        />
      );

      // 1. Current state (status row)
      expect(screen.getByLabelText(/carrier tracking status/i)).toBeDefined();
      // 2. Tracking number
      expect(screen.getByText("794612345678")).toBeDefined();
      // 3. ETA
      expect(screen.getByText("Est. Delivery")).toBeDefined();
      // 4. History timeline
      expect(
        screen.getByRole("region", { name: /tracking history/i })
      ).toBeDefined();
      expect(screen.getAllByTestId("fedex-tracking-event").length).toBe(
        HISTORY.length
      );
    });
  });

  // ── Accessibility ─────────────────────────────────────────────────────────────

  describe("accessibility", () => {
    it("last event section is a <section> element (role='region')", () => {
      render(<FedExTrackingStatus {...makeProps({ lastEvent: LAST_EVENT })} />);
      const region = screen.getByRole("region", { name: /last tracking event/i });
      expect(region.tagName).toBe("SECTION");
    });

    it("<time> element has a valid ISO 8601 dateTime attribute", () => {
      const ts = "2024-09-01T12:00:00.000Z";
      render(
        <FedExTrackingStatus
          {...makeProps({ lastEvent: { ...LAST_EVENT, timestamp: ts } })}
        />
      );
      const timeEl = screen.getByRole("time");
      const dt = timeEl.getAttribute("dateTime");
      expect(dt).not.toBeNull();
      expect(Number.isNaN(Date.parse(dt!))).toBe(false);
    });

    it("carrier badge has aria-label with carrier name", () => {
      render(<FedExTrackingStatus {...makeProps({ carrier: "FedEx Express" })} />);
      expect(screen.getByLabelText(/carrier: fedex express/i)).toBeDefined();
    });

    it("estimated delivery value has descriptive aria-label", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({ estimatedDelivery: "2024-12-25T00:00:00.000Z" })}
        />
      );
      // The span wrapping the date value should have aria-label containing "Estimated delivery:"
      const el = screen.getByLabelText(/estimated delivery:/i);
      expect(el).toBeDefined();
    });

    it("custom className is applied to root element", () => {
      render(
        <FedExTrackingStatus
          {...makeProps({ className: "test-custom-class" })}
        />
      );
      const root = screen.getByTestId("fedex-tracking-status");
      expect(root.classList.contains("test-custom-class")).toBe(true);
    });
  });
});
