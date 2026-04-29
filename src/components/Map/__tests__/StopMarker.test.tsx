/**
 * @vitest-environment jsdom
 *
 * StopMarker.test.tsx
 *
 * Unit tests for src/components/Map/StopMarker.tsx
 *
 * Coverage matrix
 * ───────────────
 *
 * Rendering variants:
 *   ✓ renders the badge with the correct stop index number
 *   ✓ default variant (not first, not last) — intermediate gray
 *   ✓ isFirst=true → data-is-first attribute set, badgeFirst class presence
 *   ✓ isLast=true → data-is-last attribute set
 *   ✓ isFirst=true AND isLast=true (single-stop journey)
 *   ✓ isSelected=true → data-is-selected + selection ring rendered
 *   ✓ isSelected=false → no selection ring rendered
 *   ✓ selection ring has data-testid="stop-marker-selection-ring"
 *
 * Accessibility:
 *   ✓ aria-label for a basic stop
 *   ✓ aria-label includes "(origin)" for first stop
 *   ✓ aria-label includes "(latest)" for last stop
 *   ✓ aria-label includes "(only stop)" when both first and last
 *   ✓ aria-label includes eventType (formatted to Title Case)
 *   ✓ aria-label includes locationName when provided
 *   ✓ aria-label includes actorName when provided
 *   ✓ aria-pressed reflects isSelected state
 *   ✓ badge title includes eventType + locationName + actorName
 *   ✓ no title when no eventType/locationName/actorName
 *
 * Interaction:
 *   ✓ onClick is called with stopIndex when badge is clicked
 *   ✓ onClick is called when Enter key is pressed on badge
 *   ✓ onClick is called when Space key is pressed on badge
 *   ✓ onClick not called when onClick prop is absent
 *   ✓ tabIndex=0 when onClick is provided
 *   ✓ tabIndex=-1 when onClick is absent (display-only)
 *   ✓ className prop is forwarded to root element
 *
 * Data attributes:
 *   ✓ data-stop-index equals the provided stopIndex
 *   ✓ data-is-first present only when isFirst=true
 *   ✓ data-is-last present only when isLast=true
 *   ✓ data-is-selected present only when isSelected=true
 *   ✓ data-event-type reflects the eventType prop
 *
 * Mapbox GL Marker integration:
 *   ✓ renders inside a Marker with the correct longitude and latitude
 *   ✓ Marker anchor is "center"
 *
 * Mocking strategy:
 *   • react-map-gl is mocked — Marker renders children directly so we can
 *     inspect the badge DOM without needing a real WebGL context.
 *   • No Convex/provider mocks needed — StopMarker is a pure presentational
 *     component with no data dependencies.
 */

import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Capture Marker props so we can assert on longitude/latitude/anchor
let lastMarkerProps: Record<string, unknown> = {};

vi.mock("react-map-gl", () => ({
  Marker: ({
    longitude,
    latitude,
    anchor,
    children,
  }: {
    longitude: number;
    latitude: number;
    anchor?: string;
    children?: React.ReactNode;
  }) => {
    lastMarkerProps = { longitude, latitude, anchor };
    return <div data-testid="mapbox-marker">{children}</div>;
  },
}));

// ─── Import component AFTER mocks ─────────────────────────────────────────────

import { StopMarker } from "../StopMarker";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  lastMarkerProps = {};
});

afterEach(() => {
  cleanup();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  stopIndex: 3,
  longitude: -71.06,
  latitude:  42.36,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Rendering variants
// ═══════════════════════════════════════════════════════════════════════════════

describe("StopMarker — rendering", () => {
  it("renders the badge with the correct stop index number", () => {
    render(<StopMarker {...DEFAULT_PROPS} stopIndex={7} />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.textContent).toContain("7");
  });

  it("renders the root container element", () => {
    render(<StopMarker {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("stop-marker")).toBeDefined();
  });

  it("intermediate stop (not first, not last) — no data-is-first or data-is-last", () => {
    const { container } = render(
      <StopMarker {...DEFAULT_PROPS} isFirst={false} isLast={false} />
    );
    const root = container.querySelector("[data-testid='stop-marker']");
    expect(root?.getAttribute("data-is-first")).toBeNull();
    expect(root?.getAttribute("data-is-last")).toBeNull();
  });

  it("isFirst=true → data-is-first='true' on root element", () => {
    const { container } = render(<StopMarker {...DEFAULT_PROPS} isFirst />);
    const root = container.querySelector("[data-testid='stop-marker']");
    expect(root?.getAttribute("data-is-first")).toBe("true");
  });

  it("isLast=true → data-is-last='true' on root element", () => {
    const { container } = render(<StopMarker {...DEFAULT_PROPS} isLast />);
    const root = container.querySelector("[data-testid='stop-marker']");
    expect(root?.getAttribute("data-is-last")).toBe("true");
  });

  it("isFirst and isLast both true → both data attributes present", () => {
    const { container } = render(
      <StopMarker {...DEFAULT_PROPS} isFirst isLast />
    );
    const root = container.querySelector("[data-testid='stop-marker']");
    expect(root?.getAttribute("data-is-first")).toBe("true");
    expect(root?.getAttribute("data-is-last")).toBe("true");
  });

  it("isSelected=true → data-is-selected='true' on root element", () => {
    const { container } = render(<StopMarker {...DEFAULT_PROPS} isSelected />);
    const root = container.querySelector("[data-testid='stop-marker']");
    expect(root?.getAttribute("data-is-selected")).toBe("true");
  });

  it("isSelected=true → selection ring element is rendered", () => {
    render(<StopMarker {...DEFAULT_PROPS} isSelected />);
    expect(screen.getByTestId("stop-marker-selection-ring")).toBeDefined();
  });

  it("isSelected=false → no selection ring rendered", () => {
    render(<StopMarker {...DEFAULT_PROPS} isSelected={false} />);
    expect(screen.queryByTestId("stop-marker-selection-ring")).toBeNull();
  });

  it("isSelected omitted → no selection ring rendered", () => {
    render(<StopMarker {...DEFAULT_PROPS} />);
    expect(screen.queryByTestId("stop-marker-selection-ring")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Accessibility
// ═══════════════════════════════════════════════════════════════════════════════

describe("StopMarker — accessibility", () => {
  it("aria-label for a basic stop includes 'Stop N'", () => {
    render(<StopMarker {...DEFAULT_PROPS} stopIndex={3} />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("aria-label")).toMatch(/Stop 3/);
  });

  it("aria-label includes '(origin)' for first stop", () => {
    render(<StopMarker {...DEFAULT_PROPS} isFirst />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("aria-label")).toMatch(/\(origin\)/i);
  });

  it("aria-label includes '(latest)' for last stop", () => {
    render(<StopMarker {...DEFAULT_PROPS} isLast />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("aria-label")).toMatch(/\(latest\)/i);
  });

  it("aria-label includes '(only stop)' when both isFirst and isLast", () => {
    render(<StopMarker {...DEFAULT_PROPS} isFirst isLast />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("aria-label")).toMatch(/\(only stop\)/i);
  });

  it("aria-label includes formatted eventType", () => {
    render(
      <StopMarker {...DEFAULT_PROPS} eventType="custody_handoff" />
    );
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("aria-label")).toMatch(/Custody Handoff/);
  });

  it("aria-label includes locationName when provided", () => {
    render(
      <StopMarker {...DEFAULT_PROPS} locationName="Chicago Hub" />
    );
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("aria-label")).toMatch(/Chicago Hub/);
  });

  it("aria-label includes actorName when provided", () => {
    render(<StopMarker {...DEFAULT_PROPS} actorName="Alice Tech" />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("aria-label")).toMatch(/Alice Tech/);
  });

  it("aria-label includes all parts when all optional props are provided", () => {
    render(
      <StopMarker
        {...DEFAULT_PROPS}
        isFirst
        eventType="status_change"
        locationName="Site Alpha"
        actorName="Bob Pilot"
      />
    );
    const label = screen.getByTestId("stop-marker-badge").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/Stop 3/);
    expect(label).toMatch(/\(origin\)/i);
    expect(label).toMatch(/Status Change/);
    expect(label).toMatch(/Site Alpha/);
    expect(label).toMatch(/Bob Pilot/);
  });

  it("aria-pressed is 'false' when isSelected=false", () => {
    render(<StopMarker {...DEFAULT_PROPS} isSelected={false} />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("aria-pressed")).toBe("false");
  });

  it("aria-pressed is 'true' when isSelected=true", () => {
    render(<StopMarker {...DEFAULT_PROPS} isSelected />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("aria-pressed")).toBe("true");
  });

  it("badge title includes eventType, locationName, and actorName", () => {
    render(
      <StopMarker
        {...DEFAULT_PROPS}
        eventType="scan_check_in"
        locationName="Depot B"
        actorName="Carol"
      />
    );
    const badge = screen.getByTestId("stop-marker-badge");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toMatch(/Scan Check In/);
    expect(title).toMatch(/Depot B/);
    expect(title).toMatch(/Carol/);
  });

  it("no title attribute when no eventType/locationName/actorName", () => {
    render(<StopMarker {...DEFAULT_PROPS} />);
    const badge = screen.getByTestId("stop-marker-badge");
    // title should be null or empty string
    const title = badge.getAttribute("title");
    expect(title === null || title === "").toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Interaction
// ═══════════════════════════════════════════════════════════════════════════════

describe("StopMarker — interaction", () => {
  it("onClick is called with stopIndex when badge is clicked", () => {
    const handler = vi.fn();
    render(<StopMarker {...DEFAULT_PROPS} stopIndex={5} onClick={handler} />);
    fireEvent.click(screen.getByTestId("stop-marker-badge"));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(5);
  });

  it("onClick is called when Enter key is pressed on badge", () => {
    const handler = vi.fn();
    render(<StopMarker {...DEFAULT_PROPS} stopIndex={2} onClick={handler} />);
    fireEvent.keyDown(screen.getByTestId("stop-marker-badge"), {
      key: "Enter",
      code: "Enter",
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(2);
  });

  it("onClick is called when Space key is pressed on badge", () => {
    const handler = vi.fn();
    render(<StopMarker {...DEFAULT_PROPS} stopIndex={4} onClick={handler} />);
    fireEvent.keyDown(screen.getByTestId("stop-marker-badge"), {
      key: " ",
      code: "Space",
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(4);
  });

  it("onClick is NOT called when onClick prop is absent", () => {
    const { container } = render(<StopMarker {...DEFAULT_PROPS} />);
    const badge = container.querySelector("[data-testid='stop-marker-badge']")!;
    // Should not throw
    expect(() => fireEvent.click(badge)).not.toThrow();
  });

  it("tabIndex=0 when onClick is provided", () => {
    render(<StopMarker {...DEFAULT_PROPS} onClick={vi.fn()} />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("tabindex")).toBe("0");
  });

  it("tabIndex=-1 when onClick is absent (display-only mode)", () => {
    render(<StopMarker {...DEFAULT_PROPS} />);
    const badge = screen.getByTestId("stop-marker-badge");
    expect(badge.getAttribute("tabindex")).toBe("-1");
  });

  it("className prop is forwarded to root element", () => {
    render(
      <StopMarker {...DEFAULT_PROPS} className="custom-marker-class" />
    );
    const root = screen.getByTestId("stop-marker");
    expect(root.className).toContain("custom-marker-class");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Data attributes
// ═══════════════════════════════════════════════════════════════════════════════

describe("StopMarker — data attributes", () => {
  it("data-stop-index equals the provided stopIndex", () => {
    render(<StopMarker {...DEFAULT_PROPS} stopIndex={8} />);
    const root = screen.getByTestId("stop-marker");
    expect(root.getAttribute("data-stop-index")).toBe("8");
  });

  it("data-is-first is absent when isFirst=false", () => {
    render(<StopMarker {...DEFAULT_PROPS} isFirst={false} />);
    const root = screen.getByTestId("stop-marker");
    expect(root.getAttribute("data-is-first")).toBeNull();
  });

  it("data-is-first='true' when isFirst=true", () => {
    render(<StopMarker {...DEFAULT_PROPS} isFirst />);
    const root = screen.getByTestId("stop-marker");
    expect(root.getAttribute("data-is-first")).toBe("true");
  });

  it("data-is-last is absent when isLast=false", () => {
    render(<StopMarker {...DEFAULT_PROPS} isLast={false} />);
    const root = screen.getByTestId("stop-marker");
    expect(root.getAttribute("data-is-last")).toBeNull();
  });

  it("data-is-last='true' when isLast=true", () => {
    render(<StopMarker {...DEFAULT_PROPS} isLast />);
    const root = screen.getByTestId("stop-marker");
    expect(root.getAttribute("data-is-last")).toBe("true");
  });

  it("data-is-selected is absent when isSelected=false", () => {
    render(<StopMarker {...DEFAULT_PROPS} isSelected={false} />);
    const root = screen.getByTestId("stop-marker");
    expect(root.getAttribute("data-is-selected")).toBeNull();
  });

  it("data-is-selected='true' when isSelected=true", () => {
    render(<StopMarker {...DEFAULT_PROPS} isSelected />);
    const root = screen.getByTestId("stop-marker");
    expect(root.getAttribute("data-is-selected")).toBe("true");
  });

  it("data-event-type reflects the eventType prop", () => {
    render(<StopMarker {...DEFAULT_PROPS} eventType="ship_case" />);
    const root = screen.getByTestId("stop-marker");
    expect(root.getAttribute("data-event-type")).toBe("ship_case");
  });

  it("data-event-type is absent when eventType is not provided", () => {
    render(<StopMarker {...DEFAULT_PROPS} />);
    const root = screen.getByTestId("stop-marker");
    expect(root.getAttribute("data-event-type")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mapbox GL Marker integration
// ═══════════════════════════════════════════════════════════════════════════════

describe("StopMarker — Mapbox GL Marker", () => {
  it("renders inside the Mapbox Marker container", () => {
    render(<StopMarker {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("mapbox-marker")).toBeDefined();
  });

  it("passes the correct longitude to Marker", () => {
    render(<StopMarker {...DEFAULT_PROPS} longitude={-122.45} />);
    expect(lastMarkerProps.longitude).toBe(-122.45);
  });

  it("passes the correct latitude to Marker", () => {
    render(<StopMarker {...DEFAULT_PROPS} latitude={37.77} />);
    expect(lastMarkerProps.latitude).toBe(37.77);
  });

  it("Marker anchor is 'center'", () => {
    render(<StopMarker {...DEFAULT_PROPS} />);
    expect(lastMarkerProps.anchor).toBe("center");
  });

  it("badge is rendered inside the Marker container", () => {
    render(<StopMarker {...DEFAULT_PROPS} />);
    const marker = screen.getByTestId("mapbox-marker");
    // Badge should be a descendant of the marker element
    expect(marker.querySelector("[data-testid='stop-marker-badge']")).not.toBeNull();
  });

  it("renders multiple markers with distinct stop indices", () => {
    render(
      <>
        <StopMarker {...DEFAULT_PROPS} stopIndex={1} isFirst />
        <StopMarker {...DEFAULT_PROPS} stopIndex={2} longitude={-70.0} />
        <StopMarker {...DEFAULT_PROPS} stopIndex={3} isLast longitude={-69.0} />
      </>
    );
    const badges = screen.getAllByTestId("stop-marker-badge");
    expect(badges).toHaveLength(3);
    expect(badges[0].textContent).toContain("1");
    expect(badges[1].textContent).toContain("2");
    expect(badges[2].textContent).toContain("3");
  });
});
