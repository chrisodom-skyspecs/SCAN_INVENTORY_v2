/**
 * @vitest-environment jsdom
 *
 * Unit tests: DossierActivityPanel — Activity tab content for T4DossierShell.
 *
 * Covers:
 *   1.  Loading state — renders skeleton when events are undefined
 *   2.  Empty state — renders empty state when events array is empty
 *   3.  Events loaded — renders activity feed list with correct count
 *   4.  Action type indicators — each entry has a colored action chip
 *   5.  User activity entries — actor name and avatar initials rendered
 *   6.  Timestamp display — timestamps rendered inside <time> elements
 *   7.  Event descriptions — per-type descriptions rendered
 *   8.  StatusPill — status pills shown for status_change, damage_reported, etc.
 *   9.  Sort order — newest event appears first in the feed
 *   10. ARIA compliance — ol with aria-label, li with aria-label for each entry
 *   11. Panel header — sticky header with title and count badge
 *   12. Count badge — reflects total event count, aria-live="polite"
 *   13. Action chip variants — brand, field, damage, neutral categories
 *   14. User avatar initials — derived from userName correctly
 *   15. data-testid attributes — all key elements have test ids
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock the useCaseEvents hook ──────────────────────────────────────────────
//
// DossierActivityPanel uses useCaseEvents which wraps useQuery (Convex).
// We mock the hook to avoid requiring a ConvexProvider in unit tests.

const mockUseCaseEvents = vi.fn();

vi.mock("../../../hooks/use-case-events", () => ({
  useCaseEvents: (...args: unknown[]) => mockUseCaseEvents(...args),
}));

// ─── Mock StatusPill ──────────────────────────────────────────────────────────

vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind} />
  ),
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

import { DossierActivityPanel } from "../DossierActivityPanel";
import type { CaseEvent } from "../../../hooks/use-case-events";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const CASE_ID = "case_abc123";

/**
 * Build a minimal CaseEvent for testing.
 */
function makeEvent(overrides: Partial<CaseEvent> = {}): CaseEvent {
  return {
    _id:       overrides._id       ?? "evt_001",
    caseId:    overrides.caseId    ?? CASE_ID,
    eventType: overrides.eventType ?? "status_change",
    userId:    overrides.userId    ?? "user_alice",
    userName:  overrides.userName  ?? "Alice Tech",
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    data:      overrides.data      ?? { fromStatus: "hangar", toStatus: "assembled" },
    ...overrides,
  };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof DossierActivityPanel>> = {}) {
  return render(
    <DossierActivityPanel caseId={CASE_ID} {...overrides} />
  );
}

afterEach(() => {
  cleanup();
  mockUseCaseEvents.mockReset();
});

// ─── 1. Loading state ─────────────────────────────────────────────────────────

describe("DossierActivityPanel — loading state", () => {
  beforeEach(() => {
    mockUseCaseEvents.mockReturnValue(undefined);
  });

  it("renders the activity skeleton when events are undefined", () => {
    renderPanel();
    expect(screen.getByTestId("activity-skeleton")).toBeTruthy();
  });

  it("skeleton has aria-busy='true'", () => {
    renderPanel();
    const skeleton = screen.getByTestId("activity-skeleton");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
  });

  it("skeleton has role='status'", () => {
    renderPanel();
    const skeleton = screen.getByTestId("activity-skeleton");
    expect(skeleton.getAttribute("role")).toBe("status");
  });

  it("does NOT render the feed list while loading", () => {
    renderPanel();
    expect(screen.queryByTestId("activity-feed-list")).toBeNull();
  });

  it("does NOT render the empty state while loading", () => {
    renderPanel();
    expect(screen.queryByTestId("activity-empty")).toBeNull();
  });

  it("renders the panel header with title in loading state", () => {
    renderPanel();
    expect(screen.getByTestId("activity-panel-header")).toBeTruthy();
    expect(screen.getByText("Activity")).toBeTruthy();
  });

  it("root has data-state='loading'", () => {
    renderPanel();
    const root = screen.getByTestId("dossier-activity-panel");
    expect(root.getAttribute("data-state")).toBe("loading");
  });
});

// ─── 2. Empty state ───────────────────────────────────────────────────────────

describe("DossierActivityPanel — empty state", () => {
  beforeEach(() => {
    mockUseCaseEvents.mockReturnValue([]);
  });

  it("renders the empty state when events array is empty", () => {
    renderPanel();
    expect(screen.getByTestId("activity-empty")).toBeTruthy();
  });

  it("empty state shows 'No activity yet' title", () => {
    renderPanel();
    expect(screen.getByText("No activity yet")).toBeTruthy();
  });

  it("does NOT render feed list in empty state", () => {
    renderPanel();
    expect(screen.queryByTestId("activity-feed-list")).toBeNull();
  });

  it("does NOT render skeleton in empty state", () => {
    renderPanel();
    expect(screen.queryByTestId("activity-skeleton")).toBeNull();
  });

  it("root has data-state='empty'", () => {
    renderPanel();
    const root = screen.getByTestId("dossier-activity-panel");
    expect(root.getAttribute("data-state")).toBe("empty");
  });

  it("does NOT render count badge in empty state", () => {
    renderPanel();
    expect(screen.queryByTestId("activity-count-badge")).toBeNull();
  });
});

// ─── 3. Events loaded ─────────────────────────────────────────────────────────

describe("DossierActivityPanel — events loaded", () => {
  const events = [
    makeEvent({ _id: "evt_001", eventType: "status_change",      timestamp: 1_700_000_000_000, userName: "Alice" }),
    makeEvent({ _id: "evt_002", eventType: "inspection_started", timestamp: 1_700_000_001_000, userName: "Bob" }),
    makeEvent({ _id: "evt_003", eventType: "damage_reported",    timestamp: 1_700_000_002_000, userName: "Carol" }),
  ];

  beforeEach(() => {
    mockUseCaseEvents.mockReturnValue(events);
  });

  it("renders the activity feed list", () => {
    renderPanel();
    expect(screen.getByTestId("activity-feed-list")).toBeTruthy();
  });

  it("renders the correct number of activity entries", () => {
    renderPanel();
    const entries = screen.getAllByTestId("activity-entry");
    expect(entries).toHaveLength(3);
  });

  it("feed list has aria-label describing count", () => {
    renderPanel();
    const list = screen.getByTestId("activity-feed-list");
    const label = list.getAttribute("aria-label");
    expect(label).toMatch(/3 activity event/);
  });

  it("root has data-state='loaded'", () => {
    renderPanel();
    const root = screen.getByTestId("dossier-activity-panel");
    expect(root.getAttribute("data-state")).toBe("loaded");
  });

  it("root has data-event-count attribute", () => {
    renderPanel();
    const root = screen.getByTestId("dossier-activity-panel");
    expect(root.getAttribute("data-event-count")).toBe("3");
  });

  it("does NOT render skeleton in loaded state", () => {
    renderPanel();
    expect(screen.queryByTestId("activity-skeleton")).toBeNull();
  });

  it("does NOT render empty state in loaded state", () => {
    renderPanel();
    expect(screen.queryByTestId("activity-empty")).toBeNull();
  });
});

// ─── 4. Action type indicators ────────────────────────────────────────────────

describe("DossierActivityPanel — action type indicators", () => {
  it("renders an action chip for each event", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ eventType: "status_change" }),
      makeEvent({ _id: "evt_002", eventType: "damage_reported" }),
    ]);
    renderPanel();
    const chips = screen.getAllByTestId("activity-action-chip");
    expect(chips).toHaveLength(2);
  });

  it("status_change shows 'STATUS' chip label", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "status_change" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.textContent).toBe("STATUS");
  });

  it("inspection_started shows 'INSPECT' chip label", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "inspection_started" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.textContent).toBe("INSPECT");
  });

  it("damage_reported shows 'DAMAGE' chip label", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "damage_reported" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.textContent).toBe("DAMAGE");
  });

  it("shipped shows 'SHIP' chip label", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "shipped" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.textContent).toBe("SHIP");
  });

  it("custody_handoff shows 'CUSTODY' chip label", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "custody_handoff" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.textContent).toBe("CUSTODY");
  });

  it("mission_assigned shows 'MISSION' chip label", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "mission_assigned" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.textContent).toBe("MISSION");
  });

  it("template_applied shows 'CONFIG' chip label", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "template_applied" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.textContent).toBe("CONFIG");
  });

  it("photo_added shows 'MEDIA' chip label", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "photo_added" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.textContent).toBe("MEDIA");
  });

  it("note_added shows 'MEDIA' chip label", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "note_added" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.textContent).toBe("MEDIA");
  });

  it("chip has aria-label describing the action type", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "status_change" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.getAttribute("aria-label")).toMatch(/status/i);
  });

  it("status_change chip has data-category='brand'", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "status_change" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.getAttribute("data-category")).toBe("brand");
  });

  it("damage_reported chip has data-category='damage'", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "damage_reported" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.getAttribute("data-category")).toBe("damage");
  });

  it("inspection_started chip has data-category='field'", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "inspection_started" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.getAttribute("data-category")).toBe("field");
  });

  it("custody_handoff chip has data-category='neutral'", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ eventType: "custody_handoff" })]);
    renderPanel();
    const chip = screen.getByTestId("activity-action-chip");
    expect(chip.getAttribute("data-category")).toBe("neutral");
  });
});

// ─── 5. User activity entries ─────────────────────────────────────────────────

describe("DossierActivityPanel — user activity entries", () => {
  it("renders the user name for each event", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ userName: "Alice Tech" }),
    ]);
    renderPanel();
    expect(screen.getByTestId("activity-user-name")).toBeTruthy();
    expect(screen.getByTestId("activity-user-name").textContent).toBe("Alice Tech");
  });

  it("renders user avatar with initials for 'Alice Tech'", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ userName: "Alice Tech" })]);
    renderPanel();
    // Avatar text is derived from initials: "AT"
    const avatars = document.querySelectorAll("[title='Alice Tech']");
    expect(avatars.length).toBeGreaterThan(0);
  });

  it("renders user avatar with single initial for single-name users", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ userName: "Bob" })]);
    renderPanel();
    const avatars = document.querySelectorAll("[title='Bob']");
    expect(avatars.length).toBeGreaterThan(0);
  });

  it("renders multiple user names for multiple events", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ _id: "e1", userName: "Alice" }),
      makeEvent({ _id: "e2", userName: "Bob" }),
    ]);
    renderPanel();
    const names = screen.getAllByTestId("activity-user-name");
    expect(names).toHaveLength(2);
    const texts = names.map((n) => n.textContent);
    expect(texts).toContain("Alice");
    expect(texts).toContain("Bob");
  });
});

// ─── 6. Timestamp display ─────────────────────────────────────────────────────

describe("DossierActivityPanel — timestamp display", () => {
  it("renders timestamps inside <time> elements", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ timestamp: 1_700_000_000_000 })]);
    renderPanel();
    const timeEl = screen.getByTestId("activity-timestamp");
    expect(timeEl.tagName.toLowerCase()).toBe("time");
  });

  it("<time> has a dateTime attribute with ISO 8601 format", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ timestamp: 1_700_000_000_000 })]);
    renderPanel();
    const timeEl = screen.getByTestId("activity-timestamp");
    const dateTime = timeEl.getAttribute("dateTime");
    expect(dateTime).toBeTruthy();
    // ISO 8601 format: "YYYY-MM-DDTHH:mm:ss.sssZ"
    expect(dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("renders one timestamp per event", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ _id: "e1", timestamp: 1_700_000_000_000 }),
      makeEvent({ _id: "e2", timestamp: 1_700_000_001_000 }),
    ]);
    renderPanel();
    const timestamps = screen.getAllByTestId("activity-timestamp");
    expect(timestamps).toHaveLength(2);
  });
});

// ─── 7. Event descriptions ────────────────────────────────────────────────────

describe("DossierActivityPanel — event descriptions", () => {
  it("renders description for status_change with fromStatus/toStatus", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({
        eventType: "status_change",
        data: { fromStatus: "hangar", toStatus: "assembled" },
      }),
    ]);
    renderPanel();
    const desc = screen.getByTestId("activity-event-description");
    expect(desc.textContent).toMatch(/hangar/);
    expect(desc.textContent).toMatch(/assembled/);
  });

  it("renders description for custody_handoff with toUserName", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({
        eventType: "custody_handoff",
        data: { fromUserName: "Alice", toUserName: "Bob" },
      }),
    ]);
    renderPanel();
    const desc = screen.getByTestId("activity-event-description");
    expect(desc.textContent).toContain("Alice");
    expect(desc.textContent).toContain("Bob");
  });

  it("renders description for shipped with tracking number", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({
        eventType: "shipped",
        data: { trackingNumber: "794644823741", destinationName: "Site Alpha" },
      }),
    ]);
    renderPanel();
    const desc = screen.getByTestId("activity-event-description");
    expect(desc.textContent).toContain("794644823741");
  });

  it("renders description for damage_reported with itemName", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({
        eventType: "damage_reported",
        data: { itemName: "Blade Assembly", severity: "high" },
      }),
    ]);
    renderPanel();
    const desc = screen.getByTestId("activity-event-description");
    expect(desc.textContent).toContain("Blade Assembly");
  });

  it("does NOT render description when data has no payload", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({
        eventType: "inspection_started",
        data: {},
      }),
    ]);
    renderPanel();
    expect(screen.queryByTestId("activity-event-description")).toBeNull();
  });
});

// ─── 8. StatusPill rendering ──────────────────────────────────────────────────

describe("DossierActivityPanel — StatusPill for semantic events", () => {
  it("renders StatusPill for status_change with valid toStatus", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({
        eventType: "status_change",
        data: { fromStatus: "hangar", toStatus: "assembled" },
      }),
    ]);
    renderPanel();
    const pill = screen.getByTestId("status-pill");
    expect(pill).toBeTruthy();
    expect(pill.getAttribute("data-kind")).toBe("assembled");
  });

  it("renders StatusPill with kind='flagged' for damage_reported", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ eventType: "damage_reported", data: {} }),
    ]);
    renderPanel();
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("flagged");
  });

  it("renders StatusPill with kind='transit_out' for shipped", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ eventType: "shipped", data: {} }),
    ]);
    renderPanel();
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("transit_out");
  });

  it("renders StatusPill with kind='received' for delivered", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ eventType: "delivered", data: {} }),
    ]);
    renderPanel();
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("received");
  });

  it("does NOT render StatusPill for custody_handoff", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ eventType: "custody_handoff", data: {} }),
    ]);
    renderPanel();
    expect(screen.queryByTestId("status-pill")).toBeNull();
  });
});

// ─── 9. Sort order (newest first) ────────────────────────────────────────────

describe("DossierActivityPanel — sort order (newest first)", () => {
  it("renders newest event as first entry in the feed", () => {
    // Server returns oldest first — panel should reverse this
    const events = [
      makeEvent({ _id: "e1", timestamp: 1_000_000, userName: "OldUser" }),
      makeEvent({ _id: "e2", timestamp: 2_000_000, userName: "NewUser" }),
    ];
    mockUseCaseEvents.mockReturnValue(events);
    renderPanel();

    const entries = screen.getAllByTestId("activity-entry");
    expect(entries).toHaveLength(2);

    // First entry in the DOM should be the newest event (timestamp 2_000_000)
    const firstEntryId = entries[0].getAttribute("data-event-id");
    expect(firstEntryId).toBe("e2"); // e2 has the higher timestamp
  });

  it("most recent event (last in server array) is rendered first in DOM", () => {
    const events = [
      makeEvent({ _id: "oldest", timestamp: 1_000 }),
      makeEvent({ _id: "middle", timestamp: 2_000 }),
      makeEvent({ _id: "newest", timestamp: 3_000 }),
    ];
    mockUseCaseEvents.mockReturnValue(events);
    renderPanel();

    const entries = screen.getAllByTestId("activity-entry");
    expect(entries[0].getAttribute("data-event-id")).toBe("newest");
    expect(entries[2].getAttribute("data-event-id")).toBe("oldest");
  });

  it("first entry has data-is-first='true'", () => {
    const events = [
      makeEvent({ _id: "e1", timestamp: 1_000 }),
      makeEvent({ _id: "e2", timestamp: 2_000 }),
    ];
    mockUseCaseEvents.mockReturnValue(events);
    renderPanel();

    const entries = screen.getAllByTestId("activity-entry");
    // After reversal, e2 is first in DOM
    expect(entries[0].getAttribute("data-is-first")).toBe("true");
    expect(entries[1].getAttribute("data-is-first")).toBeNull();
  });

  it("last entry has data-is-last='true'", () => {
    const events = [
      makeEvent({ _id: "e1", timestamp: 1_000 }),
      makeEvent({ _id: "e2", timestamp: 2_000 }),
    ];
    mockUseCaseEvents.mockReturnValue(events);
    renderPanel();

    const entries = screen.getAllByTestId("activity-entry");
    expect(entries[entries.length - 1].getAttribute("data-is-last")).toBe("true");
    expect(entries[0].getAttribute("data-is-last")).toBeNull();
  });
});

// ─── 10. ARIA compliance ──────────────────────────────────────────────────────

describe("DossierActivityPanel — ARIA compliance", () => {
  beforeEach(() => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ _id: "e1", eventType: "status_change", userName: "Alice" }),
    ]);
  });

  it("each activity entry has an aria-label", () => {
    renderPanel();
    const entry = screen.getByTestId("activity-entry");
    expect(entry.getAttribute("aria-label")).toBeTruthy();
  });

  it("aria-label includes event type and user name", () => {
    renderPanel();
    const entry = screen.getByTestId("activity-entry");
    const label = entry.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/Status Changed/);
    expect(label).toMatch(/Alice/);
  });

  it("aria-label includes position (1 of N)", () => {
    renderPanel();
    const entry = screen.getByTestId("activity-entry");
    const label = entry.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/1 of 1/);
  });

  it("feed list is an <ol> element", () => {
    renderPanel();
    const list = screen.getByTestId("activity-feed-list");
    expect(list.tagName.toLowerCase()).toBe("ol");
  });

  it("each entry is a <li> element", () => {
    renderPanel();
    const entry = screen.getByTestId("activity-entry");
    expect(entry.tagName.toLowerCase()).toBe("li");
  });

  it("panel root has aria-labelledby referencing the heading", () => {
    renderPanel();
    const root = screen.getByTestId("dossier-activity-panel");
    const labelledBy = root.getAttribute("aria-labelledby");
    expect(labelledBy).toContain("activity-heading-");
  });
});

// ─── 11. Panel header ─────────────────────────────────────────────────────────

describe("DossierActivityPanel — panel header", () => {
  it("renders panel header with data-testid='activity-panel-header'", () => {
    mockUseCaseEvents.mockReturnValue([]);
    renderPanel();
    expect(screen.getByTestId("activity-panel-header")).toBeTruthy();
  });

  it("renders 'Activity' as the panel title text", () => {
    mockUseCaseEvents.mockReturnValue([]);
    renderPanel();
    expect(screen.getByText("Activity")).toBeTruthy();
  });

  it("panel title is an h3 element", () => {
    mockUseCaseEvents.mockReturnValue([]);
    renderPanel();
    const title = screen.getByText("Activity");
    expect(title.tagName.toLowerCase()).toBe("h3");
  });

  it("panel header is present in loading state", () => {
    mockUseCaseEvents.mockReturnValue(undefined);
    renderPanel();
    expect(screen.getByTestId("activity-panel-header")).toBeTruthy();
  });

  it("panel header is present in empty state", () => {
    mockUseCaseEvents.mockReturnValue([]);
    renderPanel();
    expect(screen.getByTestId("activity-panel-header")).toBeTruthy();
  });

  it("panel header is present in loaded state", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent()]);
    renderPanel();
    expect(screen.getByTestId("activity-panel-header")).toBeTruthy();
  });
});

// ─── 12. Count badge ─────────────────────────────────────────────────────────

describe("DossierActivityPanel — count badge", () => {
  it("renders count badge showing number of events", () => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ _id: "e1" }),
      makeEvent({ _id: "e2" }),
      makeEvent({ _id: "e3" }),
    ]);
    renderPanel();
    const badge = screen.getByTestId("activity-count-badge");
    expect(badge.textContent).toBe("3");
  });

  it("count badge has aria-live='polite'", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent()]);
    renderPanel();
    const badge = screen.getByTestId("activity-count-badge");
    expect(badge.getAttribute("aria-live")).toBe("polite");
  });

  it("count badge has aria-atomic='true'", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent()]);
    renderPanel();
    const badge = screen.getByTestId("activity-count-badge");
    expect(badge.getAttribute("aria-atomic")).toBe("true");
  });

  it("count badge NOT rendered in empty state", () => {
    mockUseCaseEvents.mockReturnValue([]);
    renderPanel();
    expect(screen.queryByTestId("activity-count-badge")).toBeNull();
  });

  it("count badge NOT rendered in loading state", () => {
    mockUseCaseEvents.mockReturnValue(undefined);
    renderPanel();
    expect(screen.queryByTestId("activity-count-badge")).toBeNull();
  });
});

// ─── 13. Event label display ──────────────────────────────────────────────────

describe("DossierActivityPanel — event type labels", () => {
  const labelCases: Array<[string, string]> = [
    ["status_change",        "Status Changed"],
    ["inspection_started",   "Inspection Started"],
    ["inspection_completed", "Inspection Completed"],
    ["damage_reported",      "Damage Reported"],
    ["shipped",              "Shipped"],
    ["delivered",            "Delivered"],
    ["custody_handoff",      "Custody Handoff"],
    ["mission_assigned",     "Mission Assigned"],
    ["template_applied",     "Template Applied"],
    ["item_checked",         "Item Checked"],
    ["photo_added",          "Photo Added"],
    ["note_added",           "Note Added"],
  ];

  it.each(labelCases)("event type '%s' renders label '%s'", (eventType, expectedLabel) => {
    mockUseCaseEvents.mockReturnValue([
      makeEvent({ eventType: eventType as CaseEvent["eventType"] }),
    ]);
    renderPanel();
    const labels = screen.getAllByTestId("activity-event-label");
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0].textContent).toBe(expectedLabel);
  });
});

// ─── 14. User avatar initials ─────────────────────────────────────────────────

describe("DossierActivityPanel — user avatar initials derivation", () => {
  it("derives 'AT' initials from 'Alice Tech'", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ userName: "Alice Tech" })]);
    renderPanel();
    // The avatar is aria-hidden but its title equals the user name
    const avatar = document.querySelector("[title='Alice Tech']");
    expect(avatar).toBeTruthy();
    // "AT" = first char of "Alice" + first char of "Tech"
    expect(avatar?.textContent).toBe("AT");
  });

  it("derives single initial from single-name 'Bob'", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ userName: "Bob" })]);
    renderPanel();
    const avatar = document.querySelector("[title='Bob']");
    expect(avatar?.textContent).toBe("B");
  });

  it("derives initials from first and last word for multi-word names", () => {
    mockUseCaseEvents.mockReturnValue([makeEvent({ userName: "John Michael Smith" })]);
    renderPanel();
    // initials = first char of "John" + first char of "Smith" = "JS"
    const avatar = document.querySelector("[title='John Michael Smith']");
    expect(avatar?.textContent).toBe("JS");
  });
});

// ─── 15. data-testid attributes ───────────────────────────────────────────────

describe("DossierActivityPanel — data-testid attributes", () => {
  beforeEach(() => {
    mockUseCaseEvents.mockReturnValue([makeEvent()]);
  });

  it("root element has data-testid='dossier-activity-panel'", () => {
    renderPanel();
    expect(screen.getByTestId("dossier-activity-panel")).toBeTruthy();
  });

  it("panel header has data-testid='activity-panel-header'", () => {
    renderPanel();
    expect(screen.getByTestId("activity-panel-header")).toBeTruthy();
  });

  it("count badge has data-testid='activity-count-badge'", () => {
    renderPanel();
    expect(screen.getByTestId("activity-count-badge")).toBeTruthy();
  });

  it("feed list has data-testid='activity-feed-list'", () => {
    renderPanel();
    expect(screen.getByTestId("activity-feed-list")).toBeTruthy();
  });

  it("entry has data-testid='activity-entry'", () => {
    renderPanel();
    expect(screen.getByTestId("activity-entry")).toBeTruthy();
  });

  it("action chip has data-testid='activity-action-chip'", () => {
    renderPanel();
    expect(screen.getByTestId("activity-action-chip")).toBeTruthy();
  });

  it("event label has data-testid='activity-event-label'", () => {
    renderPanel();
    expect(screen.getByTestId("activity-event-label")).toBeTruthy();
  });

  it("user name has data-testid='activity-user-name'", () => {
    renderPanel();
    expect(screen.getByTestId("activity-user-name")).toBeTruthy();
  });

  it("timestamp has data-testid='activity-timestamp'", () => {
    renderPanel();
    expect(screen.getByTestId("activity-timestamp")).toBeTruthy();
  });
});

// ─── 16. Custom className prop ────────────────────────────────────────────────

describe("DossierActivityPanel — className prop", () => {
  it("applies custom className to the root element", () => {
    mockUseCaseEvents.mockReturnValue([]);
    renderPanel({ className: "my-custom-class" });
    const root = screen.getByTestId("dossier-activity-panel");
    expect(root.classList.contains("my-custom-class")).toBe(true);
  });
});
