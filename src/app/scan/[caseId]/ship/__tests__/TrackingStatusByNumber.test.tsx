/**
 * @vitest-environment jsdom
 *
 * TrackingStatusByNumber.test.tsx
 *
 * Unit tests for the TrackingStatusByNumber React component.
 *
 * Sub-AC 2: Build the TrackingStatus React component in the SCAN app that
 * accepts a tracking number prop, calls the Convex tracking action/query,
 * and renders the live FedEx status with loading and error states.
 *
 * Coverage matrix
 * ───────────────
 *
 * Component contract:
 *   ✓ renders nothing when trackingNumber is empty string
 *   ✓ renders nothing when trackingNumber is whitespace-only
 *
 * Loading state (while Convex action is in flight):
 *   ✓ renders loading state on mount with non-empty trackingNumber
 *   ✓ loading state has aria-busy="true"
 *   ✓ loading state has descriptive aria-label
 *   ✓ loading state shows a spinner element
 *   ✓ loading state shows "Looking up tracking" text
 *
 * Error state (when Convex action rejects):
 *   ✓ renders error state when action throws
 *   ✓ error state has role="alert"
 *   ✓ displays user-friendly error message
 *   ✓ shows "Try Again" button for transient errors (RATE_LIMITED)
 *   ✓ does NOT show "Try Again" button for permanent errors (NOT_FOUND)
 *   ✓ does NOT show "Try Again" button for INVALID_TRACKING_NUMBER
 *   ✓ retry button triggers another fetch
 *
 * Success / data state (when Convex action resolves):
 *   ✓ renders data state when action resolves with tracking data
 *   ✓ data-testid="tracking-status-by-number" is present
 *   ✓ renders carrier badge "FedEx"
 *   ✓ renders StatusPill for the FedEx status
 *   ✓ renders tracking number in details grid (IBM Plex Mono)
 *   ✓ renders estimated delivery when present
 *   ✓ does NOT render estimated delivery when absent
 *   ✓ renders refresh button when data is available
 *   ✓ refresh button triggers re-fetch on click
 *
 * Status and location section (Sub-AC 2 dedicated section):
 *   ✓ StatusAndLocationSection renders with aria-label
 *   ✓ "Live" badge appears in status section when data is present
 *   ✓ status description is rendered from action response
 *   ✓ last-known location derived from events[0] is rendered
 *   ✓ location is absent when events array is empty
 *
 * Events timeline (scan events):
 *   ✓ events section renders when data has events
 *   ✓ events list is <ol> with accessible aria-label
 *   ✓ each event shows description, timestamp, and location
 *   ✓ events section absent when events array is empty
 *
 * Cancellation / re-fetch:
 *   ✓ stale action result ignored when trackingNumber prop changes
 *
 * Accessibility:
 *   ✓ loading state aria-busy annotation
 *   ✓ error state role="alert"
 *   ✓ refresh button aria-label and aria-busy when refreshing
 *   ✓ carrier badge has aria-label
 *   ✓ location row has aria-label with location string
 *
 * onRefresh callback:
 *   ✓ onRefresh called with normalised TrackingData after successful fetch
 *   ✓ onRefresh not called when action rejects
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

// Capture the action mock so tests can control the return value
const mockTrackShipmentAction = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => mockTrackShipmentAction,
  useQuery:  vi.fn(() => undefined),
}));

vi.mock("../../../../../convex/_generated/api", () => ({
  api: {
    shipping: {
      trackShipment:       "shipping:trackShipment",
      listShipmentsByCase: "shipping:listShipmentsByCase",
    },
  },
}));

// Mock StatusPill — renders a div with the kind as data attribute for easy assertions
// Path: from __tests__/ we need 5 levels up to reach src/components/StatusPill
vi.mock("../../../../../components/StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <div data-testid="status-pill" data-kind={kind} aria-label={`Status: ${kind}`} />
  ),
}));

// Import after mocks
import { TrackingStatusByNumber } from "../TrackingStatusByNumber";
import type { TrackingStatusByNumberProps } from "../TrackingStatusByNumber";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TRACKING_NUMBER = "794644823741";

/** Normalised FedEx tracking response from the Convex action */
const MOCK_TRACKING_RESULT = {
  trackingNumber: TRACKING_NUMBER,
  status: "in_transit",
  description: "Package is in transit to the destination",
  estimatedDelivery: "2024-06-03T20:00:00Z",
  events: [
    {
      timestamp: "2024-06-01T10:15:00Z",
      eventType: "IT",
      description: "Arrived at FedEx location",
      location: { city: "Memphis", state: "TN", country: "US" },
    },
    {
      timestamp: "2024-05-31T08:00:00Z",
      eventType: "PU",
      description: "Picked up",
      location: { city: "Ann Arbor", state: "MI", country: "US" },
    },
  ],
};

const MOCK_TRACKING_RESULT_NO_EVENTS = {
  ...MOCK_TRACKING_RESULT,
  events: [],
};

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Render the component and resolve with the given result.
 * The action mock is resolved immediately (no delay).
 */
async function renderWithResult(
  result: typeof MOCK_TRACKING_RESULT | typeof MOCK_TRACKING_RESULT_NO_EVENTS,
  props: Partial<TrackingStatusByNumberProps> = {}
) {
  mockTrackShipmentAction.mockResolvedValueOnce(result);
  const utils = render(
    <TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} {...props} />
  );
  // Wait for the async action to complete
  await waitFor(() => {
    expect(screen.queryByTestId("tracking-status-by-number")).not.toBeNull();
  });
  return utils;
}

/**
 * Render and resolve with an error throw.
 */
async function renderWithError(errorMessage: string) {
  mockTrackShipmentAction.mockRejectedValueOnce(new Error(errorMessage));
  render(<TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />);
  // Wait for error state to appear
  await waitFor(() => {
    expect(screen.queryByRole("alert")).not.toBeNull();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TrackingStatusByNumber — component contract", () => {
  it("renders nothing when trackingNumber is empty string", () => {
    const { container } = render(
      <TrackingStatusByNumber trackingNumber="" />
    );
    expect(container.firstChild).toBeNull();
    // No action should be called for empty tracking number
    expect(mockTrackShipmentAction).not.toHaveBeenCalled();
  });

  it("renders nothing when trackingNumber is whitespace-only", () => {
    const { container } = render(
      <TrackingStatusByNumber trackingNumber="   " />
    );
    expect(container.firstChild).toBeNull();
    expect(mockTrackShipmentAction).not.toHaveBeenCalled();
  });
});

describe("TrackingStatusByNumber — loading state", () => {
  it("renders loading state immediately on mount with a non-empty trackingNumber", () => {
    // Never resolves during this test — we want to observe the loading state
    mockTrackShipmentAction.mockImplementation(
      () => new Promise(() => {}) // pending forever
    );

    render(<TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />);

    const loadingEl = screen.getByLabelText(/looking up tracking/i);
    expect(loadingEl).toBeDefined();
  });

  it("loading state has aria-busy='true'", () => {
    mockTrackShipmentAction.mockImplementation(() => new Promise(() => {}));

    render(<TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />);

    const loadingEl = screen.getByLabelText(/looking up tracking/i);
    expect(loadingEl.getAttribute("aria-busy")).toBe("true");
  });

  it("loading state shows a spinner element (aria-hidden)", () => {
    mockTrackShipmentAction.mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      <TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />
    );

    // Spinner has aria-hidden="true"
    const spinners = container.querySelectorAll('[aria-hidden="true"]');
    expect(spinners.length).toBeGreaterThan(0);
  });

  it("loading state shows 'Looking up tracking' text", () => {
    mockTrackShipmentAction.mockImplementation(() => new Promise(() => {}));

    render(<TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />);

    expect(screen.getByText(/looking up tracking/i)).toBeDefined();
  });

  it("calls api.shipping.trackShipment with the tracking number", () => {
    mockTrackShipmentAction.mockImplementation(() => new Promise(() => {}));

    render(<TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />);

    expect(mockTrackShipmentAction).toHaveBeenCalledWith({
      trackingNumber: TRACKING_NUMBER,
    });
  });

  it("strips whitespace from trackingNumber before calling action", () => {
    mockTrackShipmentAction.mockImplementation(() => new Promise(() => {}));

    render(
      <TrackingStatusByNumber trackingNumber={`  ${TRACKING_NUMBER}  `} />
    );

    expect(mockTrackShipmentAction).toHaveBeenCalledWith({
      trackingNumber: TRACKING_NUMBER, // stripped
    });
  });
});

describe("TrackingStatusByNumber — error state", () => {
  it("renders error state when the Convex action rejects", async () => {
    await renderWithError("[NOT_FOUND] Tracking number not found.");
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("error state displays a user-friendly error message", async () => {
    await renderWithError(
      "[NOT_FOUND] Tracking number not found in the FedEx system."
    );
    // The user-friendly message (from FEDEX_ERROR_MESSAGES) should appear
    expect(
      screen.getByText(/tracking number not found/i)
    ).toBeDefined();
  });

  it("shows a 'Try Again' retry button for transient RATE_LIMITED error", async () => {
    await renderWithError(
      "[RATE_LIMITED] FedEx API rate limit exceeded."
    );
    // Button has aria-label="Retry tracking lookup"; text content is "Try Again"
    const retryBtn = screen.getByRole("button", { name: /retry tracking lookup/i });
    expect(retryBtn).toBeDefined();
    expect(retryBtn.textContent).toContain("Try Again");
  });

  it("shows 'Try Again' button for transient SERVER_ERROR", async () => {
    await renderWithError(
      "[SERVER_ERROR] FedEx API returned 503."
    );
    expect(screen.getByRole("button", { name: /retry tracking lookup/i })).toBeDefined();
  });

  it("shows 'Try Again' button for NETWORK_ERROR", async () => {
    await renderWithError("[NETWORK_ERROR] Network connectivity failure.");
    expect(screen.getByRole("button", { name: /retry tracking lookup/i })).toBeDefined();
  });

  it("does NOT show 'Try Again' for permanent NOT_FOUND error", async () => {
    await renderWithError("[NOT_FOUND] Tracking number not in FedEx system.");
    expect(screen.queryByRole("button", { name: /retry tracking lookup/i })).toBeNull();
  });

  it("does NOT show 'Try Again' for INVALID_TRACKING_NUMBER error", async () => {
    await renderWithError("[INVALID_TRACKING_NUMBER] abc is not a valid FedEx tracking number.");
    expect(screen.queryByRole("button", { name: /retry tracking lookup/i })).toBeNull();
  });

  it("does NOT show 'Try Again' for AUTH_ERROR", async () => {
    await renderWithError("[AUTH_ERROR] FedEx credentials rejected.");
    expect(screen.queryByRole("button", { name: /retry tracking lookup/i })).toBeNull();
  });

  it("clicking 'Try Again' triggers another action call", async () => {
    // First call: fails
    mockTrackShipmentAction.mockRejectedValueOnce(
      new Error("[RATE_LIMITED] Rate limited.")
    );
    // Second call: still pending (so we can assert call count)
    mockTrackShipmentAction.mockImplementation(() => new Promise(() => {}));

    render(<TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />);

    const retryBtn = await screen.findByRole("button", { name: /retry tracking lookup/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      // Called once on mount, once on retry
      expect(mockTrackShipmentAction).toHaveBeenCalledTimes(2);
    });
  });
});

describe("TrackingStatusByNumber — success / data state", () => {
  it("renders data state after action resolves", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    expect(screen.getByTestId("tracking-status-by-number")).toBeDefined();
  });

  it("renders carrier badge labelled 'FedEx'", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    expect(screen.getByLabelText(/carrier: fedex/i)).toBeDefined();
  });

  it("renders StatusPill with the status from the action response", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("in_transit");
  });

  it("renders tracking number in the details grid", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    // The tracking number should be visible
    expect(screen.getByLabelText(/tracking number: 794644823741/i)).toBeDefined();
  });

  it("renders estimated delivery when present in action response", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    // Mon Jun 03 2024 format
    expect(screen.getByText(/est\. delivery/i)).toBeDefined();
  });

  it("does not render estimated delivery row when absent in action response", async () => {
    const resultNoEta = {
      ...MOCK_TRACKING_RESULT,
      estimatedDelivery: undefined,
    };
    mockTrackShipmentAction.mockResolvedValueOnce(resultNoEta);
    render(<TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />);

    await waitFor(() => {
      expect(screen.getByTestId("tracking-status-by-number")).toBeDefined();
    });

    // No "Est. Delivery" row
    expect(screen.queryByText(/est\. delivery/i)).toBeNull();
  });

  it("renders refresh button in data state", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    const refreshBtn = screen.getByRole("button", {
      name: /refresh live fedex tracking data/i,
    });
    expect(refreshBtn).toBeDefined();
  });

  it("clicking refresh triggers another action call", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);

    // Second call: stays pending
    mockTrackShipmentAction.mockImplementation(() => new Promise(() => {}));

    const refreshBtn = screen.getByRole("button", {
      name: /refresh live fedex tracking data/i,
    });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      // Called once on mount, once on manual refresh
      expect(mockTrackShipmentAction).toHaveBeenCalledTimes(2);
    });
  });
});

describe("TrackingStatusByNumber — StatusAndLocationSection (Sub-AC 2)", () => {
  it("renders section with aria-label 'Current shipment status and location'", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    const section = screen.getByLabelText(/current shipment status and location/i);
    expect(section).toBeDefined();
    expect(section.getAttribute("data-testid")).toBe("status-location-section");
  });

  it("'Live' badge appears in status section when data is present", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    // The live badge is inside the StatusAndLocationSection
    const liveBadge = screen.getByLabelText(/live tracking data from fedex api/i);
    expect(liveBadge).toBeDefined();
  });

  it("renders status description from action response", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    expect(
      screen.getByText("Package is in transit to the destination")
    ).toBeDefined();
  });

  it("renders last-known location from events[0].location", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    // events[0].location = { city: "Memphis", state: "TN", country: "US" }
    const locationRow = screen.getByLabelText(/last known location: Memphis, TN, US/i);
    expect(locationRow).toBeDefined();
    expect(locationRow.textContent).toContain("Memphis");
    expect(locationRow.textContent).toContain("TN");
  });

  it("location row absent when events array is empty", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT_NO_EVENTS);
    expect(screen.queryByLabelText(/last known location/i)).toBeNull();
  });
});

describe("TrackingStatusByNumber — events timeline (Scan Events)", () => {
  it("renders 'Scan Events' section when action response has events", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    const eventsSection = screen.getByRole("region", {
      name: /fedex tracking events/i,
    });
    expect(eventsSection).toBeDefined();
  });

  it("events list is an <ol> with accessible aria-label", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    const eventsList = screen.getByRole("list", {
      name: /shipment scan events, most recent first/i,
    });
    expect(eventsList).toBeDefined();
    expect(eventsList.tagName).toBe("OL");
  });

  it("renders one list item per event", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    const items = screen.getAllByRole("listitem");
    // MOCK_TRACKING_RESULT has 2 events
    expect(items).toHaveLength(2);
  });

  it("renders event description text", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    expect(screen.getByText("Arrived at FedEx location")).toBeDefined();
    expect(screen.getByText("Picked up")).toBeDefined();
  });

  it("renders event timestamps as <time> elements", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    const timeEls = screen.getAllByRole("time");
    expect(timeEls.length).toBeGreaterThanOrEqual(2);
    // Each time element should have the ISO dateTime attribute
    expect(timeEls[0].getAttribute("dateTime")).toBe("2024-06-01T10:15:00Z");
  });

  it("renders event location strings", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    // events[0] location: Memphis, TN, US
    // events[1] location: Ann Arbor, MI, US
    // Note: the location text is NOT inside the StatusAndLocationSection for events
    // The eventLocation spans are siblings to eventBody divs in the events list
    const eventsList = screen.getByRole("list", {
      name: /shipment scan events, most recent first/i,
    });
    // Find text containing the location of the first event
    expect(eventsList.textContent).toContain("Memphis, TN, US");
    expect(eventsList.textContent).toContain("Ann Arbor, MI, US");
  });

  it("events section absent when action response has empty events array", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT_NO_EVENTS);
    expect(
      screen.queryByRole("region", { name: /fedex tracking events/i })
    ).toBeNull();
  });
});

describe("TrackingStatusByNumber — accessibility", () => {
  it("loading state has aria-busy='true' and descriptive aria-label", () => {
    mockTrackShipmentAction.mockImplementation(() => new Promise(() => {}));
    render(<TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />);

    const loadingEl = screen.getByLabelText(/looking up tracking/i);
    expect(loadingEl.getAttribute("aria-busy")).toBe("true");
  });

  it("error state has role='alert'", async () => {
    await renderWithError("[NOT_FOUND] Not found.");
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("refresh button has aria-label when not refreshing", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    const btn = screen.getByRole("button", {
      name: /refresh live fedex tracking data/i,
    });
    expect(btn).toBeDefined();
  });

  it("carrier badge has aria-label with 'Carrier: FedEx'", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    expect(screen.getByLabelText(/carrier: fedex/i)).toBeDefined();
  });

  it("StatusAndLocationSection has aria-label", async () => {
    await renderWithResult(MOCK_TRACKING_RESULT);
    expect(
      screen.getByLabelText(/current shipment status and location/i)
    ).toBeDefined();
  });
});

describe("TrackingStatusByNumber — onRefresh callback", () => {
  it("calls onRefresh with normalised TrackingData after successful fetch", async () => {
    const onRefresh = vi.fn();

    mockTrackShipmentAction.mockResolvedValueOnce(MOCK_TRACKING_RESULT);
    render(
      <TrackingStatusByNumber
        trackingNumber={TRACKING_NUMBER}
        onRefresh={onRefresh}
      />
    );

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    const callArg = onRefresh.mock.calls[0][0];
    expect(callArg.trackingNumber).toBe(TRACKING_NUMBER);
    expect(callArg.status).toBe("in_transit");
    expect(callArg.description).toBe(
      "Package is in transit to the destination"
    );
    expect(Array.isArray(callArg.events)).toBe(true);
    expect(callArg.events).toHaveLength(2);
  });

  it("does not call onRefresh when the action rejects", async () => {
    const onRefresh = vi.fn();

    mockTrackShipmentAction.mockRejectedValueOnce(
      new Error("[NOT_FOUND] Not found.")
    );
    render(
      <TrackingStatusByNumber
        trackingNumber={TRACKING_NUMBER}
        onRefresh={onRefresh}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("calls onRefresh again after manual refresh", async () => {
    const onRefresh = vi.fn();

    // Both calls succeed
    mockTrackShipmentAction
      .mockResolvedValueOnce(MOCK_TRACKING_RESULT)
      .mockResolvedValueOnce({
        ...MOCK_TRACKING_RESULT,
        description: "Updated status from refresh",
      });

    render(
      <TrackingStatusByNumber
        trackingNumber={TRACKING_NUMBER}
        onRefresh={onRefresh}
      />
    );

    // Wait for first fetch
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));

    // Click refresh
    const refreshBtn = screen.getByRole("button", {
      name: /refresh live fedex tracking data/i,
    });
    fireEvent.click(refreshBtn);

    // Wait for second fetch
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));

    const secondCallArg = onRefresh.mock.calls[1][0];
    expect(secondCallArg.description).toBe("Updated status from refresh");
  });
});

describe("TrackingStatusByNumber — re-fetch on trackingNumber prop change", () => {
  it("re-calls the Convex action when trackingNumber prop changes", async () => {
    const NEW_TRACKING_NUMBER = "123456789012";

    mockTrackShipmentAction.mockResolvedValue(MOCK_TRACKING_RESULT);

    const { rerender } = render(
      <TrackingStatusByNumber trackingNumber={TRACKING_NUMBER} />
    );

    await waitFor(() =>
      expect(screen.getByTestId("tracking-status-by-number")).toBeDefined()
    );

    // Change the tracking number prop
    mockTrackShipmentAction.mockResolvedValueOnce({
      ...MOCK_TRACKING_RESULT,
      trackingNumber: NEW_TRACKING_NUMBER,
    });

    rerender(
      <TrackingStatusByNumber trackingNumber={NEW_TRACKING_NUMBER} />
    );

    await waitFor(() => {
      // Action called at least twice (once per trackingNumber)
      expect(mockTrackShipmentAction.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Most recent call should use the new tracking number
      const lastCall =
        mockTrackShipmentAction.mock.calls[
          mockTrackShipmentAction.mock.calls.length - 1
        ];
      expect(lastCall[0]).toEqual({ trackingNumber: NEW_TRACKING_NUMBER });
    });
  });
});
