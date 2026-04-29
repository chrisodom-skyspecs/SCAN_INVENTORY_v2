/**
 * @vitest-environment jsdom
 *
 * Unit tests: ConnectionIndicator — pulsing dot tied to Convex WebSocket state.
 *
 * Verifies:
 *   1. Renders a role="status" element with aria-label describing connection state.
 *   2. Shows data-status="connected" when WebSocket is connected.
 *   3. Shows data-status="connecting" when not yet connected (first connection).
 *   4. Shows data-status="reconnecting" when was connected, now offline w/ retries.
 *   5. Shows data-status="disconnected" when retries exceeded threshold.
 *   6. Shows optional label text when showLabel prop is true.
 *   7. Does not show label text by default (compact dot only).
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// ─── Mock useConvexConnectionState ────────────────────────────────────────────

const mockConnectionState = {
  isWebSocketConnected: true,
  hasEverConnected: true,
  connectionRetries: 0,
  connectionCount: 1,
  hasInflightRequests: false,
  timeOfOldestInflightRequest: null,
};

vi.mock("convex/react", () => ({
  useConvexConnectionState: () => mockConnectionState,
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { ConnectionIndicator } from "../ConnectionIndicator";

afterEach(() => {
  cleanup();
  // Reset to default connected state after each test
  mockConnectionState.isWebSocketConnected = true;
  mockConnectionState.hasEverConnected = true;
  mockConnectionState.connectionRetries = 0;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ConnectionIndicator — connected state", () => {
  it("renders a role='status' element", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator).toBeTruthy();
  });

  it("sets data-status='connected' when connected", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("data-status")).toBe("connected");
  });

  it("sets aria-label with 'Live' text when connected", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("aria-label")).toMatch(/live.*real-time/i);
  });

  it("renders a dot child with data-status='connected'", () => {
    const { container } = render(<ConnectionIndicator />);
    // The inner .dot element should also carry data-status
    const dot = container.querySelector("[data-status='connected'][aria-hidden='true']");
    expect(dot).toBeTruthy();
  });
});

describe("ConnectionIndicator — connecting state (never connected)", () => {
  beforeEach(() => {
    mockConnectionState.isWebSocketConnected = false;
    mockConnectionState.hasEverConnected = false;
    mockConnectionState.connectionRetries = 0;
  });

  it("sets data-status='connecting' when has never connected", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("data-status")).toBe("connecting");
  });

  it("sets aria-label describing connecting state", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("aria-label")).toMatch(/connecting/i);
  });
});

describe("ConnectionIndicator — reconnecting state", () => {
  beforeEach(() => {
    mockConnectionState.isWebSocketConnected = false;
    mockConnectionState.hasEverConnected = true;
    mockConnectionState.connectionRetries = 2; // below MAX_RETRY_THRESHOLD (5)
  });

  it("sets data-status='reconnecting' when was connected and retrying", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("data-status")).toBe("reconnecting");
  });

  it("sets aria-label describing reconnecting state", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("aria-label")).toMatch(/reconnecting/i);
  });
});

describe("ConnectionIndicator — disconnected state", () => {
  beforeEach(() => {
    mockConnectionState.isWebSocketConnected = false;
    mockConnectionState.hasEverConnected = true;
    mockConnectionState.connectionRetries = 10; // exceeds MAX_RETRY_THRESHOLD (5)
  });

  it("sets data-status='disconnected' when retries exceeded threshold", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("data-status")).toBe("disconnected");
  });

  it("sets aria-label describing offline/disconnected state", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("aria-label")).toMatch(/offline|unable/i);
  });
});

describe("ConnectionIndicator — showLabel prop", () => {
  it("does NOT show visible text label by default", () => {
    render(<ConnectionIndicator />);
    // The aria-label on the wrapper describes state, but no visible <span> label
    expect(screen.queryByText("Live")).toBeNull();
    expect(screen.queryByText("Connecting…")).toBeNull();
  });

  it("shows 'Live' text label when showLabel=true and connected", () => {
    render(<ConnectionIndicator showLabel />);
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("shows 'Connecting…' text label when showLabel=true and connecting", () => {
    mockConnectionState.isWebSocketConnected = false;
    mockConnectionState.hasEverConnected = false;
    render(<ConnectionIndicator showLabel />);
    expect(screen.getByText("Connecting…")).toBeTruthy();
  });

  it("shows 'Offline' text label when showLabel=true and disconnected", () => {
    mockConnectionState.isWebSocketConnected = false;
    mockConnectionState.hasEverConnected = true;
    mockConnectionState.connectionRetries = 10;
    render(<ConnectionIndicator showLabel />);
    expect(screen.getByText("Offline")).toBeTruthy();
  });
});

describe("ConnectionIndicator — accessibility", () => {
  it("the inner dot is aria-hidden", () => {
    const { container } = render(<ConnectionIndicator />);
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).toBeTruthy();
  });

  it("has aria-live='polite' for polite announcements", () => {
    render(<ConnectionIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator.getAttribute("aria-live")).toBe("polite");
  });

  it("forwards custom className to the wrapper", () => {
    render(<ConnectionIndicator className="custom-class" />);
    const indicator = screen.getByRole("status");
    expect(indicator.classList.contains("custom-class")).toBe(true);
  });
});
