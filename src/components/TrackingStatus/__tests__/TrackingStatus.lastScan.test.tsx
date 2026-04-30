/**
 * @vitest-environment jsdom
 *
 * TrackingStatus.lastScan.test.tsx
 *
 * Sub-AC 4 of AC 39:
 *   "Surface FedEx tracking status (current status, last scan, ETA) in the
 *    INVENTORY case detail UI with link to FedEx tracking page."
 *
 * These tests verify two new behaviours of the TrackingStatus component:
 *
 *   1. Last Scan section
 *      - Shown in compact variant whenever a most-recent event is available
 *        from either liveTracking.events[0] OR shipment.lastEvent (persisted).
 *      - Shown in full variant ONLY when no live events timeline is rendered
 *        (events.length === 0). When a live timeline is present, the timeline
 *        itself surfaces the latest scan as its top entry — duplicating it in
 *        a Last Scan row above would be redundant.
 *      - Renders the event description, formatted timestamp, and location.
 *
 *   2. View-on-FedEx external link
 *      - Always rendered (in both compact and full variants) for any shipment
 *        with a tracking number.
 *      - Points at https://www.fedex.com/fedextrack/?trknbr={trackingNumber}
 *        as built by `getTrackingUrl` from hooks/use-shipment-status.ts.
 *      - Opens in a new tab with rel="noopener noreferrer" for safety.
 *      - Carries an accessible aria-label that announces the destination.
 *
 * The component is tested in CONTROLLED mode — props are passed directly
 * rather than relying on Convex subscriptions — so tests run fast and
 * deterministically without needing a Convex provider.
 */

import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

// ─── Module-level mocks (hoisted before imports) ──────────────────────────────

vi.mock("convex/react", () => ({
  useQuery:  vi.fn(() => undefined),
  useAction: vi.fn(() => vi.fn()),
}));

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    shipping: {
      listShipmentsByCase: "shipping:listShipmentsByCase",
      trackShipment:       "shipping:trackShipment",
      getCaseShippingLayout: "shipping:getCaseShippingLayout",
      getShipmentByTrackingNumber: "shipping:getShipmentByTrackingNumber",
      listShipmentsByStatus: "shipping:listShipmentsByStatus",
      listActiveShipments: "shipping:listActiveShipments",
      getShipmentSummaryForCase: "shipping:getShipmentSummaryForCase",
      getCaseCarrierStatus: "shipping:getCaseCarrierStatus",
    },
  },
}));

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

import { TrackingStatus } from "../TrackingStatus";
import type { TrackingStatusControlledProps } from "../TrackingStatus";
import type {
  ShipmentRecord,
  LiveTrackingResult,
  TrackingEvent,
} from "../../../hooks/use-fedex-tracking";

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TRACKING_NUMBER = "794644823741";

const BASE_SHIPMENT: ShipmentRecord = {
  _id:            "shipment_001",
  _creationTime:  1_700_000_000_000,
  caseId:         "case_001",
  trackingNumber: TRACKING_NUMBER,
  carrier:        "FedEx",
  status:         "in_transit",
  createdAt:      1_700_000_000_000,
  updatedAt:      1_700_010_000_000,
};

function makeEvent(overrides: Partial<TrackingEvent> = {}): TrackingEvent {
  return {
    timestamp:   "2024-03-15T14:30:00.000Z",
    eventType:   "PU",
    description: "Package picked up",
    location:    { city: "Memphis", state: "TN", country: "US" },
    ...overrides,
  };
}

function makeLiveTracking(
  events: TrackingEvent[],
  overrides: Partial<LiveTrackingResult> = {}
): LiveTrackingResult {
  return {
    trackingNumber: TRACKING_NUMBER,
    status:         "in_transit",
    description:    "Package in transit",
    events,
    ...overrides,
  };
}

function makeProps(
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TrackingStatus — Last Scan section (Sub-AC 4)", () => {

  describe("compact variant", () => {
    it("renders Last Scan section when shipment has a persisted lastEvent", () => {
      const lastEvent = makeEvent({
        description: "Arrived at FedEx hub",
        timestamp:   "2024-03-16T09:00:00.000Z",
        location:    { city: "Indianapolis", state: "IN", country: "US" },
      });

      render(
        <TrackingStatus
          {...makeProps({
            variant:  "compact",
            shipment: { ...BASE_SHIPMENT, lastEvent },
          })}
        />
      );

      const lastScan = screen.getByTestId("tracking-status-last-scan");
      expect(lastScan).toBeDefined();
      expect(within(lastScan).getByText("Last Scan")).toBeDefined();
      expect(within(lastScan).getByText("Arrived at FedEx hub")).toBeDefined();
      expect(
        within(lastScan).getByText("Indianapolis, IN, US")
      ).toBeDefined();
    });

    it("prefers liveTracking.events[0] over shipment.lastEvent", () => {
      const persistedEvent = makeEvent({ description: "Old persisted event" });
      const liveEvent      = makeEvent({ description: "Brand-new live event" });

      render(
        <TrackingStatus
          {...makeProps({
            variant:      "compact",
            shipment:     { ...BASE_SHIPMENT, lastEvent: persistedEvent },
            liveTracking: makeLiveTracking([liveEvent]),
          })}
        />
      );

      const lastScan = screen.getByTestId("tracking-status-last-scan");
      expect(within(lastScan).getByText("Brand-new live event")).toBeDefined();
      expect(within(lastScan).queryByText("Old persisted event")).toBeNull();
    });

    it("does not render Last Scan when no event data exists", () => {
      render(
        <TrackingStatus
          {...makeProps({
            variant:      "compact",
            shipment:     BASE_SHIPMENT, // no lastEvent
            liveTracking: null,
          })}
        />
      );

      expect(screen.queryByTestId("tracking-status-last-scan")).toBeNull();
    });

    it("renders an ISO dateTime attribute on the Last Scan time element", () => {
      const iso = "2024-04-01T08:15:30.000Z";
      const lastEvent = makeEvent({ timestamp: iso });

      render(
        <TrackingStatus
          {...makeProps({
            variant:  "compact",
            shipment: { ...BASE_SHIPMENT, lastEvent },
          })}
        />
      );

      const lastScan = screen.getByTestId("tracking-status-last-scan");
      const timeEl   = within(lastScan).getByRole("time");
      expect(timeEl.getAttribute("dateTime")).toBe(iso);
    });
  });

  describe("full variant", () => {
    it("renders Last Scan section when no live events timeline is present", () => {
      const lastEvent = makeEvent({
        description: "Out for delivery",
        eventType:   "OD",
      });

      render(
        <TrackingStatus
          {...makeProps({
            variant:      "full",
            shipment:     { ...BASE_SHIPMENT, lastEvent },
            liveTracking: null, // no live data — Last Scan must surface persisted
          })}
        />
      );

      const lastScan = screen.getByTestId("tracking-status-last-scan");
      expect(lastScan).toBeDefined();
      expect(within(lastScan).getByText("Out for delivery")).toBeDefined();
    });

    it("does NOT render Last Scan when a live events timeline is present", () => {
      // Once the live FedEx timeline is rendered, the most recent event
      // already appears as its first item. Showing the same scan in a
      // separate Last Scan row above would be redundant.
      render(
        <TrackingStatus
          {...makeProps({
            variant:      "full",
            shipment:     {
              ...BASE_SHIPMENT,
              lastEvent: makeEvent({ description: "Persisted scan" }),
            },
            liveTracking: makeLiveTracking([
              makeEvent({ description: "Live scan" }),
            ]),
          })}
        />
      );

      expect(screen.queryByTestId("tracking-status-last-scan")).toBeNull();
      // The events timeline still renders as before
      expect(
        screen.getByRole("region", { name: /fedex tracking events/i })
      ).toBeDefined();
    });

    it("does not render Last Scan when shipment has no lastEvent and no live data", () => {
      render(
        <TrackingStatus
          {...makeProps({
            variant:      "full",
            shipment:     BASE_SHIPMENT,
            liveTracking: null,
          })}
        />
      );

      expect(screen.queryByTestId("tracking-status-last-scan")).toBeNull();
    });
  });
});

describe("TrackingStatus — View on FedEx external link (Sub-AC 4)", () => {

  it("renders a FedEx tracking page link in the compact variant", () => {
    render(
      <TrackingStatus {...makeProps({ variant: "compact" })} />
    );

    const link = screen.getByTestId("tracking-status-fedex-link");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(
      `https://www.fedex.com/fedextrack/?trknbr=${TRACKING_NUMBER}`
    );
  });

  it("renders a FedEx tracking page link in the full variant", () => {
    render(
      <TrackingStatus {...makeProps({ variant: "full" })} />
    );

    const link = screen.getByTestId("tracking-status-fedex-link");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(
      `https://www.fedex.com/fedextrack/?trknbr=${TRACKING_NUMBER}`
    );
  });

  it("opens in a new tab with rel='noopener noreferrer'", () => {
    render(
      <TrackingStatus {...makeProps({ variant: "compact" })} />
    );

    const link = screen.getByTestId("tracking-status-fedex-link");
    expect(link.getAttribute("target")).toBe("_blank");

    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("URL-encodes tracking numbers that contain special characters", () => {
    const oddTn = "DT/123 456";
    render(
      <TrackingStatus
        {...makeProps({
          variant:  "full",
          shipment: { ...BASE_SHIPMENT, trackingNumber: oddTn },
        })}
      />
    );

    const link = screen.getByTestId("tracking-status-fedex-link");
    const href = link.getAttribute("href")!;
    // encodeURIComponent → spaces become %20, slash becomes %2F
    expect(href).toContain("%20");
    expect(href).toContain("%2F");
  });

  it("has an accessible label that announces the destination as fedex.com and 'opens in new tab'", () => {
    render(
      <TrackingStatus {...makeProps({ variant: "compact" })} />
    );

    const link = screen.getByTestId("tracking-status-fedex-link");
    const ariaLabel = link.getAttribute("aria-label") ?? "";
    expect(ariaLabel.toLowerCase()).toContain("fedex.com");
    expect(ariaLabel.toLowerCase()).toContain("new tab");
    expect(ariaLabel).toContain(TRACKING_NUMBER);
  });

  it("link text reads 'View on FedEx'", () => {
    render(
      <TrackingStatus {...makeProps({ variant: "full" })} />
    );

    const link = screen.getByTestId("tracking-status-fedex-link");
    expect(link.textContent).toContain("View on FedEx");
  });
});

describe("TrackingStatus — combined ETA + last scan + link surfaces", () => {

  it("simultaneously renders status pill, ETA, last scan, and FedEx link in compact variant", () => {
    const lastEvent = makeEvent({
      description: "Picked up",
      location:    { city: "Memphis", state: "TN", country: "US" },
    });

    render(
      <TrackingStatus
        {...makeProps({
          variant:  "compact",
          shipment: {
            ...BASE_SHIPMENT,
            estimatedDelivery: "2024-03-20T18:00:00.000Z",
            lastEvent,
          },
        })}
      />
    );

    // Status pill exists
    expect(screen.getByText(/in transit/i)).toBeDefined();
    // ETA row is rendered
    expect(screen.getByText("Est. Delivery")).toBeDefined();
    // Last Scan section is rendered
    expect(screen.getByTestId("tracking-status-last-scan")).toBeDefined();
    // FedEx external link is rendered
    expect(screen.getByTestId("tracking-status-fedex-link")).toBeDefined();
  });

  it("simultaneously renders status pill, ETA, last scan, and FedEx link in full variant (no live data)", () => {
    const lastEvent = makeEvent({ description: "At local sort facility" });

    render(
      <TrackingStatus
        {...makeProps({
          variant:  "full",
          shipment: {
            ...BASE_SHIPMENT,
            estimatedDelivery: "2024-03-20T18:00:00.000Z",
            lastEvent,
          },
          liveTracking: null,
        })}
      />
    );

    expect(screen.getByText(/in transit/i)).toBeDefined();
    expect(screen.getByText("Est. Delivery")).toBeDefined();
    expect(screen.getByTestId("tracking-status-last-scan")).toBeDefined();
    expect(screen.getByTestId("tracking-status-fedex-link")).toBeDefined();
  });
});
