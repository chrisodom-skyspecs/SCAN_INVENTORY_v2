/**
 * @vitest-environment jsdom
 *
 * MiniMapSidebar.test.tsx
 *
 * Unit tests for the MiniMapSidebar component
 * (src/components/Map/MiniMapSidebar.tsx — AC 130201, Sub-AC 1).
 *
 * The MiniMapSidebar is a fixed-dimension overlay sidebar that renders a
 * condensed representation of all timeline entries alongside a map canvas.
 *
 * Test coverage:
 *
 *   Container structure (fixed vertical layout):
 *     1.  Renders an <aside> with role="complementary"
 *     2.  aria-label on <aside> reflects title and event count
 *     3.  data-testid is forwarded to the root element
 *     4.  className prop is forwarded to root <aside>
 *
 *   Header (fixed, non-scrolling):
 *     5.  Header renders the title text
 *     6.  Default title is "Timeline" when title prop is omitted
 *     7.  Count badge renders when entries > 0
 *     8.  Count badge shows entries.length when totalCount is omitted
 *     9.  Count badge shows totalCount when explicitly provided
 *     10. Count badge has aria-live="polite" and aria-atomic="true"
 *     11. Count badge is hidden when displayCount === 0 and !isLoading
 *     12. Close button renders only when onClose is provided
 *     13. Close button is absent when onClose is not provided
 *     14. Clicking the close button calls onClose
 *     15. Close button has a descriptive aria-label containing the title
 *
 *   Scrollable inner content area:
 *     16. Entry list is rendered as an <ol>
 *     17. Entry list has data-testid="mini-map-sidebar-list"
 *     18. Entry list has an aria-label with the event count
 *     19. Each entry renders as an <li> in the list
 *     20. Entry list is the scrollable inner content container
 *
 *   Entry rendering (condensed representation of timeline entries):
 *     21. Each entry has an aria-label combining event type and case label
 *     22. Each entry has data-event-type set to the event type slug
 *     23. First entry has data-is-first="true"
 *     24. Last entry has data-is-last="true"
 *     25. Intermediate entries have neither data-is-first nor data-is-last
 *     26. Dot renders with correct data-variant for each event type
 *     27. Dot renders with data-no-location="true" when hasCoordinates=false
 *     28. Dot renders without data-no-location when hasCoordinates=true
 *     29. Thread is hidden on the last entry (data-is-last="true")
 *     30. Event type label renders the human-readable display label
 *     31. Unknown event type slug falls back to Title Case
 *     32. Case label renders in the entry
 *     33. Timestamp renders inside a <time> element with dateTime attribute
 *     34. Actor name renders when actorName is provided
 *     35. Actor name is absent when actorName is omitted
 *
 *   Loading state (skeleton):
 *     36. Skeleton renders when isLoading=true
 *     37. Entry list is absent when isLoading=true
 *     38. Empty state is absent when isLoading=true
 *     39. Skeleton renders 5 placeholder rows
 *
 *   Empty state:
 *     40. Empty state renders when entries=[] and isLoading=false
 *     41. Empty state has data-testid="mini-map-sidebar-empty"
 *     42. Entry list is absent when entries=[]
 *
 *   Footer (optional):
 *     43. Footer renders when footer prop is provided
 *     44. Footer has data-testid="mini-map-sidebar-footer"
 *     45. Footer is absent when footer prop is omitted
 *
 *   Event type dot variants:
 *     46. status_change dot has data-variant="brand"
 *     47. damage_reported dot has data-variant="error"
 *     48. shipped dot has data-variant="transit"
 *     49. inspection_completed dot has data-variant="success"
 *     50. custody_handoff dot has data-variant="neutral"
 *
 * Mocking strategy
 * ────────────────
 * • No Convex dependencies — MiniMapSidebar is purely prop-driven.
 * • CSS module is stubbed to empty object (class names become undefined).
 * • No real DOM scroll measurement — the scrollable list container is only
 *   verified to exist with the expected attributes, not measured in pixels.
 */

import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── CSS module stub ──────────────────────────────────────────────────────────

vi.mock("../MiniMapSidebar.module.css", () => ({ default: {} }));

// ─── Component import (after mocks) ──────────────────────────────────────────

import { MiniMapSidebar, type MiniMapEntry } from "../MiniMapSidebar";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<MiniMapEntry> = {}): MiniMapEntry {
  return {
    entryId:        "evt-001",
    eventType:      "status_change",
    timestamp:      1_700_000_000_000,
    caseLabel:      "CS-042",
    actorName:      "Alice Tech",
    hasCoordinates: true,
    ...overrides,
  };
}

const ENTRY_1 = makeEntry({
  entryId:   "evt-001",
  eventType: "status_change",
  timestamp: 1_700_000_000_000,
  caseLabel: "CS-001",
});

const ENTRY_2 = makeEntry({
  entryId:   "evt-002",
  eventType: "shipped",
  timestamp: 1_700_000_100_000,
  caseLabel: "CS-002",
});

const ENTRY_3 = makeEntry({
  entryId:   "evt-003",
  eventType: "damage_reported",
  timestamp: 1_700_000_200_000,
  caseLabel: "CS-003",
});

const THREE_ENTRIES = [ENTRY_1, ENTRY_2, ENTRY_3];

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MiniMapSidebar — container structure (fixed vertical layout)", () => {

  it("1. renders an <aside> with role='complementary'", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const aside = screen.getByRole("complementary");
    expect(aside).toBeTruthy();
    expect(aside.tagName.toLowerCase()).toBe("aside");
  });

  it("2. aria-label on <aside> reflects title and event count", () => {
    render(
      <MiniMapSidebar
        title="Recent Events"
        entries={THREE_ENTRIES}
      />
    );
    const aside = screen.getByRole("complementary");
    const label = aside.getAttribute("aria-label");
    expect(label).toContain("Recent Events");
    expect(label).toContain("3");
  });

  it("3. data-testid is forwarded to the root element", () => {
    const { container } = render(
      <MiniMapSidebar entries={THREE_ENTRIES} data-testid="custom-sidebar" />
    );
    expect(container.querySelector("[data-testid='custom-sidebar']")).not.toBeNull();
  });

  it("4. className prop is forwarded to root <aside>", () => {
    const { container } = render(
      <MiniMapSidebar entries={THREE_ENTRIES} className="my-overlay-class" />
    );
    const aside = container.querySelector("aside");
    expect(aside!.className).toContain("my-overlay-class");
  });
});

describe("MiniMapSidebar — header (fixed, non-scrolling)", () => {

  it("5. header renders the title text", () => {
    render(<MiniMapSidebar title="All Events" entries={THREE_ENTRIES} />);
    expect(screen.getByText("All Events")).toBeTruthy();
  });

  it("6. default title is 'Timeline' when title prop is omitted", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    expect(screen.getByText("Timeline")).toBeTruthy();
  });

  it("7. count badge renders when entries > 0", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const badge = screen.getByTestId("mini-map-sidebar-count");
    expect(badge).toBeTruthy();
  });

  it("8. count badge shows entries.length when totalCount is omitted", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const badge = screen.getByTestId("mini-map-sidebar-count");
    expect(badge.textContent).toBe("3");
  });

  it("9. count badge shows totalCount when explicitly provided", () => {
    render(
      <MiniMapSidebar
        entries={THREE_ENTRIES.slice(0, 1)} // 1 entry shown, 250 total
        totalCount={250}
      />
    );
    const badge = screen.getByTestId("mini-map-sidebar-count");
    expect(badge.textContent).toBe("250");
  });

  it("10. count badge has aria-live='polite' and aria-atomic='true'", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const badge = screen.getByTestId("mini-map-sidebar-count");
    expect(badge.getAttribute("aria-live")).toBe("polite");
    expect(badge.getAttribute("aria-atomic")).toBe("true");
  });

  it("11. count badge is hidden when totalCount=0 and isLoading=false", () => {
    render(
      <MiniMapSidebar
        entries={[]}
        totalCount={0}
        isLoading={false}
      />
    );
    expect(screen.queryByTestId("mini-map-sidebar-count")).toBeNull();
  });

  it("12. close button renders when onClose is provided", () => {
    render(
      <MiniMapSidebar
        entries={THREE_ENTRIES}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("mini-map-sidebar-close")).toBeTruthy();
  });

  it("13. close button is absent when onClose is not provided", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    expect(screen.queryByTestId("mini-map-sidebar-close")).toBeNull();
  });

  it("14. clicking the close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <MiniMapSidebar
        entries={THREE_ENTRIES}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId("mini-map-sidebar-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("15. close button has a descriptive aria-label containing the title", () => {
    render(
      <MiniMapSidebar
        title="Fleet Events"
        entries={THREE_ENTRIES}
        onClose={() => {}}
      />
    );
    const closeBtn = screen.getByTestId("mini-map-sidebar-close");
    expect(closeBtn.getAttribute("aria-label")).toContain("Fleet Events");
  });
});

describe("MiniMapSidebar — scrollable inner content area", () => {

  it("16. entry list is rendered as an <ol>", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");
    expect(list.tagName.toLowerCase()).toBe("ol");
  });

  it("17. entry list has data-testid='mini-map-sidebar-list'", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    expect(screen.getByTestId("mini-map-sidebar-list")).toBeTruthy();
  });

  it("18. entry list has an aria-label with the event count", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");
    const label = list.getAttribute("aria-label");
    expect(label).toContain("3");
    expect(label).toContain("event");
  });

  it("19. each entry renders as an <li> in the list", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");
    const items = list.querySelectorAll("li");
    expect(items.length).toBe(3);
  });

  it("20. entry list is the scrollable inner content container (flex:1 overflow-y:auto)", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    // The <ol> is the scrollable region — verify it exists as a child of the <aside>
    const aside = screen.getByRole("complementary");
    const list  = screen.getByTestId("mini-map-sidebar-list");
    expect(aside.contains(list)).toBe(true);
  });
});

describe("MiniMapSidebar — entry rendering (condensed timeline representation)", () => {

  it("21. each entry has an aria-label combining event type and case label", () => {
    render(<MiniMapSidebar entries={[ENTRY_1]} />);
    const list = screen.getByTestId("mini-map-sidebar-list");
    const item = list.querySelector("li")!;
    const label = item.getAttribute("aria-label")!;
    expect(label).toContain("Status Changed"); // formatted event type label
    expect(label).toContain("CS-001");          // case label
  });

  it("22. each entry has data-event-type set to the event type slug", () => {
    render(<MiniMapSidebar entries={[ENTRY_1]} />);
    const list = screen.getByTestId("mini-map-sidebar-list");
    const item = list.querySelector("li")!;
    expect(item.getAttribute("data-event-type")).toBe("status_change");
  });

  it("23. first entry has data-is-first='true'", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const item = screen.getByTestId("mini-map-sidebar-entry-0");
    expect(item.getAttribute("data-is-first")).toBe("true");
  });

  it("24. last entry has data-is-last='true'", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const item = screen.getByTestId("mini-map-sidebar-entry-2");
    expect(item.getAttribute("data-is-last")).toBe("true");
  });

  it("25. intermediate entries have neither data-is-first nor data-is-last", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const item = screen.getByTestId("mini-map-sidebar-entry-1");
    expect(item.getAttribute("data-is-first")).toBeNull();
    expect(item.getAttribute("data-is-last")).toBeNull();
  });

  it("26. dot renders with correct data-variant for status_change (brand)", () => {
    render(
      <MiniMapSidebar
        entries={[makeEntry({ eventType: "status_change" })]}
      />
    );
    const list = screen.getByTestId("mini-map-sidebar-list");
    // The dot is the first aria-hidden element inside the dotCol
    const dot = list.querySelector("[data-variant]");
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute("data-variant")).toBe("brand");
  });

  it("27. dot has data-no-location='true' when hasCoordinates=false", () => {
    render(
      <MiniMapSidebar
        entries={[makeEntry({ hasCoordinates: false })]}
      />
    );
    const list = screen.getByTestId("mini-map-sidebar-list");
    const dot  = list.querySelector("[data-variant]");
    expect(dot!.getAttribute("data-no-location")).toBe("true");
  });

  it("28. dot does not have data-no-location when hasCoordinates=true", () => {
    render(
      <MiniMapSidebar
        entries={[makeEntry({ hasCoordinates: true })]}
      />
    );
    const list = screen.getByTestId("mini-map-sidebar-list");
    const dot  = list.querySelector("[data-variant]");
    expect(dot!.getAttribute("data-no-location")).toBeNull();
  });

  it("29. thread is hidden on the last entry (data-is-last='true' applied)", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const lastItem = screen.getByTestId("mini-map-sidebar-entry-2");
    expect(lastItem.getAttribute("data-is-last")).toBe("true");
    // CSS hides the thread via [data-is-last="true"] .thread { display: none }
    // In unit tests we verify the attribute is present (CSS isn't applied in jsdom)
  });

  it("30. event type label renders the human-readable display label", () => {
    render(
      <MiniMapSidebar
        entries={[makeEntry({ eventType: "inspection_completed" })]}
      />
    );
    // The label "Inspection Completed" should appear in the rendered output
    const list = screen.getByTestId("mini-map-sidebar-list");
    expect(list.textContent).toContain("Inspection Completed");
  });

  it("31. unknown event type slug falls back to Title Case", () => {
    render(
      <MiniMapSidebar
        entries={[makeEntry({ eventType: "custom_event_type" })]}
      />
    );
    const list = screen.getByTestId("mini-map-sidebar-list");
    expect(list.textContent).toContain("Custom Event Type");
  });

  it("32. case label renders in the entry", () => {
    render(
      <MiniMapSidebar
        entries={[makeEntry({ caseLabel: "CS-999" })]}
      />
    );
    const caseLabel = screen.getByTestId("mini-map-sidebar-case-label");
    expect(caseLabel.textContent).toBe("CS-999");
  });

  it("33. timestamp renders inside a <time> element with dateTime attribute", () => {
    const ts = 1_700_000_000_000;
    render(
      <MiniMapSidebar
        entries={[makeEntry({ timestamp: ts })]}
      />
    );
    const timeEl = screen.getByTestId("mini-map-sidebar-timestamp");
    expect(timeEl.tagName.toLowerCase()).toBe("time");
    // dateTime should be the ISO string of the epoch ms
    const expectedISO = new Date(ts).toISOString();
    expect(timeEl.getAttribute("dateTime")).toBe(expectedISO);
  });

  it("34. actor name renders when actorName is provided", () => {
    render(
      <MiniMapSidebar
        entries={[makeEntry({ actorName: "Bob Pilot" })]}
      />
    );
    const actor = screen.getByTestId("mini-map-sidebar-actor");
    expect(actor.textContent).toBe("Bob Pilot");
  });

  it("35. actor name is absent when actorName is omitted", () => {
    const entry: MiniMapEntry = {
      entryId:   "evt-no-actor",
      eventType: "status_change",
      timestamp: 1_700_000_000_000,
      caseLabel: "CS-000",
      // actorName intentionally omitted
    };
    render(<MiniMapSidebar entries={[entry]} />);
    expect(screen.queryByTestId("mini-map-sidebar-actor")).toBeNull();
  });
});

describe("MiniMapSidebar — loading state (skeleton)", () => {

  it("36. skeleton renders when isLoading=true", () => {
    const { container } = render(
      <MiniMapSidebar entries={[]} isLoading={true} />
    );
    // Skeleton rows are aria-hidden <li> elements in a loading <ol>
    const loadingList = container.querySelector("[aria-busy='true']");
    expect(loadingList).not.toBeNull();
  });

  it("37. entry list (mini-map-sidebar-list) is absent when isLoading=true", () => {
    render(<MiniMapSidebar entries={[]} isLoading={true} />);
    expect(screen.queryByTestId("mini-map-sidebar-list")).toBeNull();
  });

  it("38. empty state is absent when isLoading=true", () => {
    render(<MiniMapSidebar entries={[]} isLoading={true} />);
    expect(screen.queryByTestId("mini-map-sidebar-empty")).toBeNull();
  });

  it("39. skeleton renders 5 placeholder rows", () => {
    const { container } = render(
      <MiniMapSidebar entries={[]} isLoading={true} />
    );
    // Each skeleton row is an aria-hidden <li>
    const loadingList = container.querySelector("[aria-busy='true']");
    expect(loadingList).not.toBeNull();
    const skeletonRows = loadingList!.querySelectorAll("[aria-hidden='true']");
    expect(skeletonRows.length).toBe(5);
  });
});

describe("MiniMapSidebar — empty state", () => {

  it("40. empty state renders when entries=[] and isLoading=false", () => {
    render(<MiniMapSidebar entries={[]} isLoading={false} />);
    expect(screen.getByTestId("mini-map-sidebar-empty")).toBeTruthy();
  });

  it("41. empty state has data-testid='mini-map-sidebar-empty'", () => {
    render(<MiniMapSidebar entries={[]} />);
    expect(screen.getByTestId("mini-map-sidebar-empty")).toBeTruthy();
  });

  it("42. entry list is absent when entries=[]", () => {
    render(<MiniMapSidebar entries={[]} />);
    expect(screen.queryByTestId("mini-map-sidebar-list")).toBeNull();
  });
});

describe("MiniMapSidebar — optional footer", () => {

  it("43. footer renders when footer prop is provided", () => {
    render(
      <MiniMapSidebar
        entries={THREE_ENTRIES}
        footer={<button data-testid="load-more">Load more</button>}
      />
    );
    expect(screen.getByTestId("mini-map-sidebar-footer")).toBeTruthy();
    expect(screen.getByTestId("load-more")).toBeTruthy();
  });

  it("44. footer has data-testid='mini-map-sidebar-footer'", () => {
    render(
      <MiniMapSidebar
        entries={THREE_ENTRIES}
        footer={<span>Footer content</span>}
      />
    );
    const footer = screen.getByTestId("mini-map-sidebar-footer");
    expect(footer).toBeTruthy();
    expect(footer.textContent).toContain("Footer content");
  });

  it("45. footer is absent when footer prop is omitted", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    expect(screen.queryByTestId("mini-map-sidebar-footer")).toBeNull();
  });
});

describe("MiniMapSidebar — event type dot variants", () => {

  it("46. status_change dot has data-variant='brand'", () => {
    render(
      <MiniMapSidebar entries={[makeEntry({ eventType: "status_change" })]} />
    );
    const list = screen.getByTestId("mini-map-sidebar-list");
    expect(list.querySelector("[data-variant='brand']")).not.toBeNull();
  });

  it("47. damage_reported dot has data-variant='error'", () => {
    render(
      <MiniMapSidebar entries={[makeEntry({ eventType: "damage_reported" })]} />
    );
    const list = screen.getByTestId("mini-map-sidebar-list");
    expect(list.querySelector("[data-variant='error']")).not.toBeNull();
  });

  it("48. shipped dot has data-variant='transit'", () => {
    render(
      <MiniMapSidebar entries={[makeEntry({ eventType: "shipped" })]} />
    );
    const list = screen.getByTestId("mini-map-sidebar-list");
    expect(list.querySelector("[data-variant='transit']")).not.toBeNull();
  });

  it("49. inspection_completed dot has data-variant='success'", () => {
    render(
      <MiniMapSidebar entries={[makeEntry({ eventType: "inspection_completed" })]} />
    );
    const list = screen.getByTestId("mini-map-sidebar-list");
    expect(list.querySelector("[data-variant='success']")).not.toBeNull();
  });

  it("50. custody_handoff dot has data-variant='neutral'", () => {
    render(
      <MiniMapSidebar entries={[makeEntry({ eventType: "custody_handoff" })]} />
    );
    const list = screen.getByTestId("mini-map-sidebar-list");
    expect(list.querySelector("[data-variant='neutral']")).not.toBeNull();
  });
});

describe("MiniMapSidebar — singular/plural aria-label", () => {

  it("aria-label on <aside> uses singular 'event' for 1 entry", () => {
    render(<MiniMapSidebar entries={[ENTRY_1]} />);
    const aside = screen.getByRole("complementary");
    expect(aside.getAttribute("aria-label")).toContain("1 event");
    expect(aside.getAttribute("aria-label")).not.toContain("events");
  });

  it("aria-label on <aside> uses plural 'events' for 3 entries", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const aside = screen.getByRole("complementary");
    expect(aside.getAttribute("aria-label")).toContain("3 events");
  });

  it("entry list aria-label uses singular 'event' for 1 entry", () => {
    render(<MiniMapSidebar entries={[ENTRY_1]} />);
    const list = screen.getByTestId("mini-map-sidebar-list");
    const label = list.getAttribute("aria-label")!;
    // "1 timeline event" — singular, no trailing 's'
    expect(label).toContain("1 timeline event");
    expect(label).not.toContain("events");
  });
});

describe("MiniMapSidebar — single entry edge case", () => {

  it("single entry is both first and last (both data attributes)", () => {
    render(<MiniMapSidebar entries={[ENTRY_1]} />);
    const item = screen.getByTestId("mini-map-sidebar-entry-0");
    expect(item.getAttribute("data-is-first")).toBe("true");
    expect(item.getAttribute("data-is-last")).toBe("true");
  });
});

describe("MiniMapSidebar — default data-testid", () => {

  it("default data-testid is 'mini-map-sidebar'", () => {
    const { container } = render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    expect(container.querySelector("[data-testid='mini-map-sidebar']")).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Position indicator — Sub-AC 2
//
// The position indicator is a thin vertical track (`.positionTrack`) rendered
// on the left edge of the scroll region, containing a sized thumb
// (`.positionThumb`) that marks the currently visible viewport.
//
// In jsdom all scroll metrics (scrollTop, scrollHeight, clientHeight) are 0,
// so the indicator is hidden by default (scrollHeight ≤ clientHeight → false).
//
// Tests that exercise overflow state mock the properties on the rendered <ol>
// and dispatch a scroll event to trigger recomputation.
//
// Test plan
// ─────────
//   51. Position track is NOT visible by default (no DOM overflow in jsdom).
//   52. Position track testid "mini-map-position-track" exists only when visible.
//   53. Position indicator is NOT visible when isLoading=true (skeleton, no list).
//   54. Position indicator is NOT visible when entries=[] (empty state, no list).
//   55. Position track appears when list is scrollable (mocked scroll metrics).
//   56. Position indicator (thumb) appears inside the track when list overflows.
//   57. Position indicator has data-testid="mini-map-position-indicator".
//   58. Position track is aria-hidden="true" (decorative, skipped by screen readers).
//   59. Position indicator (thumb) is inside the track (DOM parent relationship).
//   60. Thumb top style is set to a pixel value when indicator is visible.
//   61. Thumb height style is set to a pixel value when indicator is visible.
//   62. Thumb top is "0px" when scrolled to the top of the list.
//   63. Thumb top is greater than 0 when scrolled partway down.
//   64. Thumb height reflects the visible-to-total ratio (clientHeight/scrollHeight).
//   65. Indicator hides again when the list is no longer overflowing (scroll reset).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper — mock the scroll metrics of an element, dispatch a scroll event,
 * and wait for React to flush the state update.
 *
 * jsdom does not implement real layout, so scrollHeight / clientHeight / scrollTop
 * always return 0.  Object.defineProperty overrides the getter for the duration
 * of a single test.  After the test, `afterEach` cleanup removes the element
 * from the DOM, so property descriptors are also discarded.
 */
async function mockScrollOverflow(
  el: Element,
  opts: { scrollTop?: number; scrollHeight: number; clientHeight: number }
): Promise<void> {
  const { scrollTop = 0, scrollHeight, clientHeight } = opts;

  Object.defineProperty(el, "scrollTop",    { configurable: true, value: scrollTop });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });

  // Dispatch scroll event to trigger the component's passive scroll listener.
  // fireEvent.scroll wraps the event in act(), so React state updates are flushed.
  await act(async () => {
    el.dispatchEvent(new Event("scroll"));
  });
}

import { act } from "@testing-library/react";

describe("MiniMapSidebar — position indicator (Sub-AC 2)", () => {

  it("51. position track is NOT visible by default (no scroll overflow in jsdom)", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    // jsdom scroll metrics all zero → scrollHeight ≤ clientHeight → indicator hidden
    expect(screen.queryByTestId("mini-map-position-track")).toBeNull();
    expect(screen.queryByTestId("mini-map-position-indicator")).toBeNull();
  });

  it("52. position track testid is absent when there is no overflow", () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    expect(screen.queryByTestId("mini-map-position-track")).toBeNull();
  });

  it("53. position indicator is NOT visible when isLoading=true (skeleton state)", () => {
    render(<MiniMapSidebar entries={[]} isLoading={true} />);
    // Skeleton renders; no <ol> with the listRef → indicator stays hidden
    expect(screen.queryByTestId("mini-map-position-track")).toBeNull();
    expect(screen.queryByTestId("mini-map-position-indicator")).toBeNull();
  });

  it("54. position indicator is NOT visible when entries=[] (empty state)", () => {
    render(<MiniMapSidebar entries={[]} isLoading={false} />);
    // Empty state renders; no <ol> with the listRef → indicator stays hidden
    expect(screen.queryByTestId("mini-map-position-track")).toBeNull();
    expect(screen.queryByTestId("mini-map-position-indicator")).toBeNull();
  });

  it("55. position track appears when list scroll metrics indicate overflow", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    // Simulate overflow: content (600px) taller than container (200px)
    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200 });

    expect(screen.getByTestId("mini-map-position-track")).toBeTruthy();
  });

  it("56. position indicator (thumb) appears inside the track when list overflows", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200 });

    expect(screen.getByTestId("mini-map-position-indicator")).toBeTruthy();
  });

  it("57. position indicator has data-testid='mini-map-position-indicator'", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200 });

    const thumb = screen.getByTestId("mini-map-position-indicator");
    expect(thumb).toBeTruthy();
    expect(thumb.getAttribute("data-testid")).toBe("mini-map-position-indicator");
  });

  it("58. position track is aria-hidden='true' (decorative)", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200 });

    const track = screen.getByTestId("mini-map-position-track");
    expect(track.getAttribute("aria-hidden")).toBe("true");
  });

  it("59. position indicator thumb is a child of the track element", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200 });

    const track = screen.getByTestId("mini-map-position-track");
    const thumb = screen.getByTestId("mini-map-position-indicator");
    expect(track.contains(thumb)).toBe(true);
  });

  it("60. thumb has a 'top' inline style set to a px value when indicator is visible", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });

    const thumb = screen.getByTestId("mini-map-position-indicator");
    // top is always set as a px value
    expect(thumb.style.top).toMatch(/^\d+(\.\d+)?px$/);
  });

  it("61. thumb has a 'height' inline style set to a px value when indicator is visible", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200 });

    const thumb = screen.getByTestId("mini-map-position-indicator");
    expect(thumb.style.height).toMatch(/^\d+(\.\d+)?px$/);
  });

  it("62. thumb top is '0px' when scrolled to the top of the list (scrollTop=0)", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    // scrollTop=0 → at the very top → thumbTop must be 0
    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });

    const thumb = screen.getByTestId("mini-map-position-indicator");
    expect(thumb.style.top).toBe("0px");
  });

  it("63. thumb top is greater than 0 when scrolled partway down", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    // scrollTop = 200 → halfway through a 400px scroll range (scrollHeight 600 - clientHeight 200)
    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200, scrollTop: 200 });

    const thumb = screen.getByTestId("mini-map-position-indicator");
    const topValue = parseFloat(thumb.style.top);
    expect(topValue).toBeGreaterThan(0);
  });

  it("64. thumb height reflects the visible-to-total ratio (clientHeight / scrollHeight × clientHeight)", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    // clientHeight=200, scrollHeight=400 → ratio=0.5 → rawHeight=100 → height=max(100,16)=100
    await mockScrollOverflow(list, { scrollHeight: 400, clientHeight: 200 });

    const thumb = screen.getByTestId("mini-map-position-indicator");
    const heightValue = parseFloat(thumb.style.height);
    // Expected: (200/400) * 200 = 100px, clamped to min 16px → 100px
    expect(heightValue).toBeCloseTo(100, 0);
  });

  it("65. indicator hides again when a subsequent scroll event reports no overflow", async () => {
    render(<MiniMapSidebar entries={THREE_ENTRIES} />);
    const list = screen.getByTestId("mini-map-sidebar-list");

    // First: make it overflow → indicator visible
    await mockScrollOverflow(list, { scrollHeight: 600, clientHeight: 200 });
    expect(screen.getByTestId("mini-map-position-track")).toBeTruthy();

    // Second: reset metrics so there is no overflow → indicator should hide
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 100 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 200 });
    await act(async () => {
      list.dispatchEvent(new Event("scroll"));
    });

    expect(screen.queryByTestId("mini-map-position-track")).toBeNull();
  });
});
