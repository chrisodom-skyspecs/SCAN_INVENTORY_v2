/**
 * @vitest-environment jsdom
 *
 * M2StopSidebar.test.tsx
 *
 * Unit tests for the M2StopSidebar component
 * (src/components/Map/M2StopSidebar.tsx — Sub-AC 2).
 *
 * The sidebar renders a scrollable StopCard list overlay for all stops in the
 * M2 replay timeline, positioned over the M2 map canvas.  These tests verify:
 *
 *   Rendering & structure:
 *     1.  Renders an <aside> with role="complementary"
 *     2.  aria-label on <aside> includes the caseLabel
 *     3.  data-testid is forwarded to the root element
 *     4.  Header displays the caseLabel
 *     5.  Header displays the stop count (singular "stop")
 *     6.  Header displays the stop count (plural "stops")
 *     7.  Close button renders with aria-label including caseLabel
 *     8.  Clicking the close button calls onClose
 *     9.  The stop list is an <ol> with the correct aria-label
 *    10.  All stops render as StopCard-containing list items
 *    11.  Empty state renders when stops=[]
 *    12.  Empty state is absent when stops are provided
 *
 *   Replay banner:
 *    13.  Replay banner is absent when at=null
 *    14.  Replay banner appears when at is a Date
 *    15.  Replay banner has data-testid="m2-stop-sidebar-replay-banner"
 *    16.  Replay banner shows a <time> element with dateTime attribute
 *
 *   Active stop determination (replayActiveIndex):
 *    17.  selectedStopIndex=null, at=null → last stop is active (data-active="true")
 *    18.  selectedStopIndex=null, at=null, stops=[] → no active item
 *    19.  at is set → last stop at or before `at` is active
 *    20.  stop after `at` is marked data-future="true"
 *    21.  stop at exactly `at` timestamp is active (not future)
 *    22.  selectedStopIndex overrides at-based active stop
 *    23.  selectedStopIndex=1, at null → stop 1 is active
 *
 *   aria-current and aria-pressed:
 *    24.  Active stop has aria-current="true"
 *    25.  Future stops do not have aria-current
 *    26.  aria-pressed=true on the explicitly selected stop
 *    27.  aria-pressed=false on non-selected stops
 *
 *   Keyboard interaction:
 *    28.  Clicking a stop item calls onStopClick with the stopIndex
 *    29.  Enter key on a stop item calls onStopClick
 *    30.  Space key on a stop item calls onStopClick
 *    31.  Each stop item has tabIndex=0
 *    32.  Each stop item has role="button"
 *
 *   StopCard content:
 *    33.  StopCard receives correct stopNumber
 *    34.  isFirst=true passed to the first stop's StopCard
 *    35.  isLast=true passed to the last stop's StopCard
 *    36.  Intermediate stops have isFirst=false, isLast=false
 *    37.  hasLocation=false when stop.hasCoordinates is false
 *
 *   CSS class application:
 *    38.  className prop is forwarded to root <aside>
 *    39.  Active stop item has data-active="true"
 *    40.  Future stop has data-future="true"
 *    41.  data-selected="true" on explicitly selected stop
 *
 * Mocking strategy
 * ────────────────
 * • StopCard is mocked to a simple <div> with data-testid and forwarded props
 *   so we can inspect what props are passed without rendering the full card.
 * • No Convex dependencies — M2StopSidebar is purely prop-driven.
 * • CSS module is stubbed to empty object (class names become undefined).
 */

import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JourneyStop } from "@/hooks/use-m2-journey-stops";

// ─── Mock StopCard ────────────────────────────────────────────────────────────
//
// Renders a simple <div> that forwards key props as data-* attributes so tests
// can verify the props passed without rendering the full StopCard component.

const mockStopCard = vi.fn((props: Record<string, unknown>): React.ReactNode => null);

vi.mock("@/components/StopCard", () => ({
  StopCard: (props: Record<string, unknown>) => mockStopCard(props),
}));

// ─── CSS module stub ──────────────────────────────────────────────────────────

vi.mock("../M2StopSidebar.module.css", () => ({ default: {} }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

const STOP_1 = makeStop({
  stopIndex: 1,
  eventId:   "evt-001",
  timestamp: 1_700_000_000_000,
});

const STOP_2 = makeStop({
  stopIndex: 2,
  eventId:   "evt-002",
  timestamp: 1_700_000_100_000, // 100 seconds after stop 1
});

const STOP_3 = makeStop({
  stopIndex: 3,
  eventId:   "evt-003",
  timestamp: 1_700_000_200_000, // 200 seconds after stop 1
});

const THREE_STOPS = [STOP_1, STOP_2, STOP_3];

// ─── Default props ────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  stops:             THREE_STOPS,
  caseLabel:         "CASE-001",
  stopCount:         3,
  at:                null as Date | null,
  selectedStopIndex: null as number | null,
  onStopClick:       vi.fn(),
  onClose:           vi.fn(),
};

// ─── Component import (after mocks) ──────────────────────────────────────────

import { M2StopSidebar } from "../M2StopSidebar";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockStopCard.mockImplementation((props: Record<string, unknown>) => (
    <div
      data-testid={props["data-testid"] as string ?? "stop-card"}
      data-stop-number={props.stopNumber as number}
      data-is-first={props.isFirst ? "true" : undefined}
      data-is-last={props.isLast ? "true" : undefined}
      data-has-location={props.hasLocation === false ? "false" : "true"}
      data-actor={props.actorName as string}
      data-location={props.locationName as string}
    />
  ));
});

afterEach(() => {
  cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("M2StopSidebar — rendering & structure", () => {

  it("1. renders an <aside> with role='complementary'", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} />);
    const aside = screen.getByRole("complementary");
    expect(aside).toBeTruthy();
    expect(aside.tagName.toLowerCase()).toBe("aside");
  });

  it("2. aria-label on <aside> includes the caseLabel", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} caseLabel="CASE-XYZ" />);
    const aside = screen.getByRole("complementary");
    expect(aside.getAttribute("aria-label")).toContain("CASE-XYZ");
  });

  it("3. data-testid is forwarded to the root element", () => {
    const { container } = render(
      <M2StopSidebar {...DEFAULT_PROPS} data-testid="custom-sidebar" />
    );
    expect(container.querySelector("[data-testid='custom-sidebar']")).not.toBeNull();
  });

  it("4. header displays the caseLabel", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} caseLabel="CASE-ALPHA" />);
    const label = screen.getByTestId("m2-stop-sidebar-label");
    expect(label.textContent).toBe("CASE-ALPHA");
  });

  it("5. header displays stop count as singular '1 stop'", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        stops={[STOP_1]}
        stopCount={1}
      />
    );
    const count = screen.getByTestId("m2-stop-sidebar-count");
    expect(count.textContent).toBe("1 stop");
  });

  it("6. header displays stop count as plural '3 stops'", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} stopCount={3} />);
    const count = screen.getByTestId("m2-stop-sidebar-count");
    expect(count.textContent).toBe("3 stops");
  });

  it("7. close button has aria-label including caseLabel", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} caseLabel="CASE-001" />);
    const closeBtn = screen.getByTestId("m2-stop-sidebar-close");
    expect(closeBtn.getAttribute("aria-label")).toContain("CASE-001");
  });

  it("8. clicking the close button calls onClose", () => {
    const onClose = vi.fn();
    render(<M2StopSidebar {...DEFAULT_PROPS} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("m2-stop-sidebar-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("9. stop list is an <ol> with correct aria-label", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} stopCount={3} caseLabel="CASE-001" />);
    const list = screen.getByTestId("m2-stop-sidebar-list");
    expect(list.tagName.toLowerCase()).toBe("ol");
    expect(list.getAttribute("aria-label")).toContain("3 journey stops");
    expect(list.getAttribute("aria-label")).toContain("CASE-001");
  });

  it("10. all 3 stops render as list items containing StopCards", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} />);
    // StopCard is mocked — count how many times it was called
    expect(mockStopCard).toHaveBeenCalledTimes(3);
  });

  it("11. empty state renders when stops=[]", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        stops={[]}
        stopCount={0}
      />
    );
    expect(screen.getByTestId("m2-stop-sidebar-empty")).toBeTruthy();
    expect(screen.queryByTestId("m2-stop-sidebar-list")).toBeNull();
  });

  it("12. empty state is absent when stops are provided", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} />);
    expect(screen.queryByTestId("m2-stop-sidebar-empty")).toBeNull();
    expect(screen.getByTestId("m2-stop-sidebar-list")).toBeTruthy();
  });
});

describe("M2StopSidebar — replay banner", () => {

  it("13. replay banner is absent when at=null", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} at={null} />);
    expect(screen.queryByTestId("m2-stop-sidebar-replay-banner")).toBeNull();
  });

  it("14. replay banner appears when at is a Date", () => {
    const at = new Date(STOP_1.timestamp + 50_000);
    render(<M2StopSidebar {...DEFAULT_PROPS} at={at} />);
    expect(screen.getByTestId("m2-stop-sidebar-replay-banner")).toBeTruthy();
  });

  it("15. replay banner has data-testid='m2-stop-sidebar-replay-banner'", () => {
    const at = new Date(STOP_2.timestamp);
    render(<M2StopSidebar {...DEFAULT_PROPS} at={at} />);
    const banner = screen.getByTestId("m2-stop-sidebar-replay-banner");
    expect(banner).toBeTruthy();
  });

  it("16. replay banner shows a <time> element with dateTime attribute", () => {
    const at = new Date(1_700_000_050_000);
    render(<M2StopSidebar {...DEFAULT_PROPS} at={at} />);
    const banner = screen.getByTestId("m2-stop-sidebar-replay-banner");
    const timeEl = banner.querySelector("time");
    expect(timeEl).not.toBeNull();
    expect(timeEl!.getAttribute("dateTime")).toBe(at.toISOString());
  });
});

describe("M2StopSidebar — active stop determination", () => {

  it("17. selectedStopIndex=null, at=null → last stop is active", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        selectedStopIndex={null}
        at={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    // Stop 3 is last — should have data-active="true"
    const items = list.querySelectorAll("[data-stop-index]");
    const lastItem = items[items.length - 1];
    expect(lastItem.getAttribute("data-active")).toBe("true");
    expect(lastItem.getAttribute("data-stop-index")).toBe("3");
  });

  it("18. selectedStopIndex=null, at=null, stops=[] → no active item", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        stops={[]}
        stopCount={0}
        selectedStopIndex={null}
        at={null}
      />
    );
    // Empty state — no list items
    expect(screen.queryByTestId("m2-stop-sidebar-list")).toBeNull();
  });

  it("19. at is set → last stop at or before `at` is active", () => {
    // at is between stop 1 and stop 2
    const at = new Date(STOP_1.timestamp + 50_000);
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={at}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    // Stop 1 should be active (last stop at or before `at`)
    const item1 = list.querySelector("[data-stop-index='1']");
    expect(item1!.getAttribute("data-active")).toBe("true");
  });

  it("20. stop after `at` is marked data-future='true'", () => {
    // at is between stop 1 and stop 2 — stops 2 and 3 are future
    const at = new Date(STOP_1.timestamp + 50_000);
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={at}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item2 = list.querySelector("[data-stop-index='2']");
    const item3 = list.querySelector("[data-stop-index='3']");
    expect(item2!.getAttribute("data-future")).toBe("true");
    expect(item3!.getAttribute("data-future")).toBe("true");
  });

  it("21. stop at exactly `at` timestamp is active (boundary: not future)", () => {
    // at exactly equals STOP_2.timestamp — stop 2 should be active, not future
    const at = new Date(STOP_2.timestamp);
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={at}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item2 = list.querySelector("[data-stop-index='2']");
    expect(item2!.getAttribute("data-active")).toBe("true");
    expect(item2!.getAttribute("data-future")).toBeNull();
  });

  it("22. selectedStopIndex overrides at-based active stop", () => {
    // at points to stop 1, but selectedStopIndex=3
    const at = new Date(STOP_1.timestamp + 50_000);
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={at}
        selectedStopIndex={3}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    // Stop 1 is not active (selectedStopIndex overrides)
    const item1 = list.querySelector("[data-stop-index='1']");
    expect(item1!.getAttribute("data-active")).toBeNull();
    // Stop 3 is active
    const item3 = list.querySelector("[data-stop-index='3']");
    expect(item3!.getAttribute("data-active")).toBe("true");
  });

  it("23. selectedStopIndex=1, at null → stop 1 is active", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={null}
        selectedStopIndex={1}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item1 = list.querySelector("[data-stop-index='1']");
    // Stop 1 is selected explicitly
    expect(item1!.getAttribute("data-active")).toBe("true");
    // Stop 3 is not active (even though it's last)
    const item3 = list.querySelector("[data-stop-index='3']");
    expect(item3!.getAttribute("data-active")).toBeNull();
  });
});

describe("M2StopSidebar — aria-current and aria-pressed", () => {

  it("24. active stop has aria-current='true'", () => {
    // Live mode — stop 3 (last) is active
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={null}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item3 = list.querySelector("[data-stop-index='3']");
    expect(item3!.getAttribute("aria-current")).toBe("true");
  });

  it("25. future stops do not have aria-current", () => {
    const at = new Date(STOP_1.timestamp + 50_000);
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={at}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item2 = list.querySelector("[data-stop-index='2']");
    const item3 = list.querySelector("[data-stop-index='3']");
    expect(item2!.getAttribute("aria-current")).toBeNull();
    expect(item3!.getAttribute("aria-current")).toBeNull();
  });

  it("26. aria-pressed=true on the explicitly selected stop", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        selectedStopIndex={2}
        at={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item2 = list.querySelector("[data-stop-index='2']");
    expect(item2!.getAttribute("aria-pressed")).toBe("true");
  });

  it("27. aria-pressed=false on non-selected stops", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        selectedStopIndex={2}
        at={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item1 = list.querySelector("[data-stop-index='1']");
    const item3 = list.querySelector("[data-stop-index='3']");
    expect(item1!.getAttribute("aria-pressed")).toBe("false");
    expect(item3!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("M2StopSidebar — keyboard interaction", () => {

  it("28. clicking a stop item calls onStopClick with the stopIndex", () => {
    const onStopClick = vi.fn();
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        onStopClick={onStopClick}
        at={null}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item2 = list.querySelector("[data-stop-index='2']") as HTMLElement;
    fireEvent.click(item2);
    expect(onStopClick).toHaveBeenCalledWith(2);
  });

  it("29. Enter key on a stop item calls onStopClick", () => {
    const onStopClick = vi.fn();
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        onStopClick={onStopClick}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item1 = list.querySelector("[data-stop-index='1']") as HTMLElement;
    fireEvent.keyDown(item1, { key: "Enter" });
    expect(onStopClick).toHaveBeenCalledWith(1);
  });

  it("30. Space key on a stop item calls onStopClick", () => {
    const onStopClick = vi.fn();
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        onStopClick={onStopClick}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item3 = list.querySelector("[data-stop-index='3']") as HTMLElement;
    fireEvent.keyDown(item3, { key: " " });
    expect(onStopClick).toHaveBeenCalledWith(3);
  });

  it("31. each stop item has tabIndex=0", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} />);
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const items = list.querySelectorAll("[data-stop-index]");
    items.forEach((item) => {
      expect(item.getAttribute("tabindex")).toBe("0");
    });
  });

  it("32. each stop item has role='button'", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} />);
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const items = list.querySelectorAll("[data-stop-index]");
    items.forEach((item) => {
      expect(item.getAttribute("role")).toBe("button");
    });
  });
});

describe("M2StopSidebar — StopCard props", () => {

  it("33. StopCard receives the correct stopNumber", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} />);
    // 3 calls: stop 1, 2, 3
    const calls = mockStopCard.mock.calls;
    expect(calls[0][0].stopNumber).toBe(1);
    expect(calls[1][0].stopNumber).toBe(2);
    expect(calls[2][0].stopNumber).toBe(3);
  });

  it("34. isFirst=true passed to the first stop's StopCard", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} />);
    const firstCall = mockStopCard.mock.calls[0][0];
    expect(firstCall.isFirst).toBe(true);
  });

  it("35. isLast=true passed to the last stop's StopCard", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} />);
    const lastCall = mockStopCard.mock.calls[mockStopCard.mock.calls.length - 1][0];
    expect(lastCall.isLast).toBe(true);
  });

  it("36. intermediate stops have isFirst=false, isLast=false", () => {
    render(<M2StopSidebar {...DEFAULT_PROPS} />);
    // Stop 2 is the middle stop
    const middleCall = mockStopCard.mock.calls[1][0];
    expect(middleCall.isFirst).toBe(false);
    expect(middleCall.isLast).toBe(false);
  });

  it("37. hasLocation=false passed when stop.hasCoordinates is false", () => {
    const stopNoLocation = makeStop({ hasCoordinates: false });
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        stops={[stopNoLocation]}
        stopCount={1}
      />
    );
    const call = mockStopCard.mock.calls[0][0];
    expect(call.hasLocation).toBe(false);
  });
});

describe("M2StopSidebar — CSS class and data attribute application", () => {

  it("38. className prop is forwarded to root <aside>", () => {
    const { container } = render(
      <M2StopSidebar {...DEFAULT_PROPS} className="custom-class" />
    );
    const aside = container.querySelector("aside");
    expect(aside!.className).toContain("custom-class");
  });

  it("39. active stop item has data-active='true'", () => {
    // at=null, selectedStopIndex=null → last stop (3) is active
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={null}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item3 = list.querySelector("[data-stop-index='3']");
    expect(item3!.getAttribute("data-active")).toBe("true");
  });

  it("40. future stop has data-future='true'", () => {
    // at = stop 1 timestamp → stop 2 and 3 are future
    const at = new Date(STOP_1.timestamp);
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={at}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item2 = list.querySelector("[data-stop-index='2']");
    expect(item2!.getAttribute("data-future")).toBe("true");
  });

  it("41. data-selected='true' on explicitly selected stop", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        selectedStopIndex={2}
        at={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item2 = list.querySelector("[data-stop-index='2']");
    expect(item2!.getAttribute("data-selected")).toBe("true");
    // Others are not selected
    const item1 = list.querySelector("[data-stop-index='1']");
    const item3 = list.querySelector("[data-stop-index='3']");
    expect(item1!.getAttribute("data-selected")).toBeNull();
    expect(item3!.getAttribute("data-selected")).toBeNull();
  });
});

describe("M2StopSidebar — single stop edge case", () => {

  it("single stop is both isFirst and isLast", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        stops={[STOP_1]}
        stopCount={1}
      />
    );
    const call = mockStopCard.mock.calls[0][0];
    expect(call.isFirst).toBe(true);
    expect(call.isLast).toBe(true);
  });

  it("single stop is active in live mode (at=null)", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        stops={[STOP_1]}
        stopCount={1}
        at={null}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item1 = list.querySelector("[data-stop-index='1']");
    expect(item1!.getAttribute("data-active")).toBe("true");
  });

  it("no stop is active when at is before the earliest stop timestamp", () => {
    // at is before stop 1 — no stop qualifies as active
    const at = new Date(STOP_1.timestamp - 10_000);
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        stops={[STOP_1]}
        stopCount={1}
        at={at}
        selectedStopIndex={null}
      />
    );
    const list = screen.getByTestId("m2-stop-sidebar-list");
    const item1 = list.querySelector("[data-stop-index='1']");
    // Stop 1 is after `at` — it should be future, not active
    expect(item1!.getAttribute("data-active")).toBeNull();
    expect(item1!.getAttribute("data-future")).toBe("true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sub-AC 3: Auto-scroll wiring — scroll/focus active stop card as replay
// cursor advances or is manually scrubbed.
//
// These tests verify that useReplayScrollSync is correctly integrated into
// M2StopSidebar: scrollIntoView is called on the active stop's <li> element
// whenever the replayActiveIndex changes (driven by `at` or selectedStopIndex).
//
// Mocking strategy for scroll:
//   • window.HTMLElement.prototype.scrollIntoView is replaced with a vi.fn()
//     spy in a nested beforeEach so it doesn't affect the other test suites
//     that don't need it.
//   • The spy is reset in afterEach to avoid cross-test pollution.
// ─────────────────────────────────────────────────────────────────────────────

describe("M2StopSidebar — auto-scroll to active stop (Sub-AC 3)", () => {
  let scrollSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Install scrollIntoView spy — jsdom does not implement scrollIntoView,
    // so we assign to the prototype to intercept all calls.
    scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView =
      scrollSpy as unknown as HTMLElement["scrollIntoView"];
  });

  afterEach(() => {
    // Remove the spy so later tests that don't mock scrollIntoView are unaffected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).scrollIntoView = undefined;
  });

  it("42. calls scrollIntoView on mount for the active stop (live mode → last stop)", () => {
    // Live mode: at=null, selectedStopIndex=null → stop 3 (last) is active
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={null}
        selectedStopIndex={null}
      />
    );
    // useReplayScrollSync fires on mount → scrolls to stop 3
    expect(scrollSpy).toHaveBeenCalledOnce();
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("43. scrolls to the correct stop element on mount", () => {
    let scrollTarget: string | null = null;
    scrollSpy.mockImplementation(function (this: HTMLElement) {
      scrollTarget = this.getAttribute("data-stop-index");
    });

    // Live mode → stop 3 is active
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={null}
        selectedStopIndex={null}
      />
    );

    expect(scrollTarget).toBe("3");
  });

  it("44. scrolls to the at-based active stop on mount (replay mode)", () => {
    let scrollTarget: string | null = null;
    scrollSpy.mockImplementation(function (this: HTMLElement) {
      scrollTarget = this.getAttribute("data-stop-index");
    });

    // at is between stop 1 and stop 2 → stop 1 is active
    const at = new Date(STOP_1.timestamp + 50_000);
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={at}
        selectedStopIndex={null}
      />
    );

    expect(scrollTarget).toBe("1");
  });

  it("45. re-scrolls when at advances past a stop boundary (stop 1 → stop 2)", () => {
    const { rerender } = render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_1.timestamp + 50_000)} // stop 1 active
        selectedStopIndex={null}
      />
    );

    // Scroll called once on mount
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    scrollSpy.mockClear();

    // Advance at past stop 2's timestamp → replayActiveIndex changes to 2
    rerender(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_2.timestamp + 10_000)} // stop 2 active
        selectedStopIndex={null}
      />
    );

    // scrollIntoView called again for the new active stop
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("46. scrolls to the new active stop element when cursor crosses stop boundary", () => {
    const targets: string[] = [];
    scrollSpy.mockImplementation(function (this: HTMLElement) {
      const idx = this.getAttribute("data-stop-index");
      if (idx) targets.push(idx);
    });

    const { rerender } = render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_1.timestamp + 50_000)} // stop 1 active
        selectedStopIndex={null}
      />
    );

    // Advance through each stop
    rerender(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_2.timestamp + 10_000)} // stop 2 active
        selectedStopIndex={null}
      />
    );
    rerender(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_3.timestamp + 10_000)} // stop 3 active
        selectedStopIndex={null}
      />
    );

    // Should have scrolled to stops 1, 2, and 3 in order
    expect(targets).toEqual(["1", "2", "3"]);
  });

  it("47. does NOT re-scroll when at changes but active stop remains the same", () => {
    const { rerender } = render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_1.timestamp + 10_000)} // stop 1 active
        selectedStopIndex={null}
      />
    );

    scrollSpy.mockClear();

    // at moves forward but stays between stop 1 and stop 2 → same active stop
    rerender(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_1.timestamp + 50_000)} // still stop 1 active
        selectedStopIndex={null}
      />
    );

    // replayActiveIndex did not change → no additional scroll
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("48. scrolls to the selected stop when selectedStopIndex changes (user click)", () => {
    let scrollTarget: string | null = null;
    scrollSpy.mockImplementation(function (this: HTMLElement) {
      scrollTarget = this.getAttribute("data-stop-index");
    });

    const { rerender } = render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={null}
        selectedStopIndex={null}
      />
    );

    scrollSpy.mockClear();
    scrollTarget = null;

    // User clicks stop 1 → selectedStopIndex changes → replayActiveIndex changes
    rerender(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={null}
        selectedStopIndex={1}
      />
    );

    expect(scrollSpy).toHaveBeenCalledOnce();
    expect(scrollTarget).toBe("1");
  });

  it("49. selectedStopIndex overrides at-based scroll target", () => {
    let scrollTarget: string | null = null;
    scrollSpy.mockImplementation(function (this: HTMLElement) {
      scrollTarget = this.getAttribute("data-stop-index");
    });

    // at points to stop 1, but selectedStopIndex=3 → stop 3 should be scrolled to
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_1.timestamp + 50_000)}
        selectedStopIndex={3}
      />
    );

    // selectedStopIndex=3 takes precedence → scroll to stop 3
    expect(scrollTarget).toBe("3");
  });

  it("50. does NOT scroll when stops is empty (no active stop)", () => {
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        stops={[]}
        stopCount={0}
        at={null}
        selectedStopIndex={null}
      />
    );
    // No active stop (replayActiveIndex=null) → no scrollIntoView call
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("51. does NOT scroll when at is before all stops (all stops are future)", () => {
    // at is before stop 1 → replayActiveIndex=null
    const at = new Date(STOP_1.timestamp - 10_000);
    render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={at}
        selectedStopIndex={null}
      />
    );
    // No stop qualifies as active → no scrollIntoView
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("52. scroll uses { behavior: 'smooth', block: 'nearest' } in all cases", () => {
    const { rerender } = render(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_1.timestamp + 50_000)}
        selectedStopIndex={null}
      />
    );

    rerender(
      <M2StopSidebar
        {...DEFAULT_PROPS}
        at={new Date(STOP_2.timestamp + 10_000)}
        selectedStopIndex={null}
      />
    );

    // Every call should use the same smooth options
    for (const call of scrollSpy.mock.calls) {
      expect(call[0]).toEqual({ behavior: "smooth", block: "nearest" });
    }
    expect(scrollSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
