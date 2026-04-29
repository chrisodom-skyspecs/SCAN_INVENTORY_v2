/**
 * @vitest-environment jsdom
 *
 * EventCard.test.tsx
 *
 * Unit tests for the EventCard component.
 *
 * Covers:
 *   - Rendering: article root, aria-label, data attributes
 *   - Event type label: known slugs → human-readable labels, fallback
 *   - Timestamp: <time> element, dateTime ISO attribute, display value
 *   - Label prop: custom label overrides eventType fallback
 *   - Status pill: rendered when status prop is provided
 *   - Case label: rendered in monospace, absent when not provided
 *   - Actor name: rendered and absent behavior
 *   - Detail: rendered and absent behavior
 *   - Variant states: data-variant attribute, all four variants
 *   - Event dot: data-dot-variant attribute for known event types
 *   - Interactive mode: onClick → <button> wrapper, aria-pressed
 *   - Selection: isSelected → aria-pressed="true"
 *   - Non-interactive static mode (no button wrapper)
 *   - className forwarding
 *   - data-testid forwarding
 */

import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventCard } from "../EventCard";
import type { EventVariant } from "../EventCard";

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => cleanup());

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Epoch ms timestamp (2023-11-14T22:13:20.000Z) */
const TIMESTAMP     = 1_700_000_000_000;
const TIMESTAMP_ISO = new Date(TIMESTAMP).toISOString();

/** Minimal required props */
const MINIMAL = {
  eventType: "status_change",
  timestamp: TIMESTAMP,
} as const;

// ─── Rendering ────────────────────────────────────────────────────────────────

describe("EventCard — rendering", () => {
  it("renders without errors with minimal required props", () => {
    expect(() => render(<EventCard {...MINIMAL} />)).not.toThrow();
  });

  it("root element is an <article>", () => {
    render(<EventCard {...MINIMAL} />);
    expect(screen.getByRole("article")).toBeDefined();
  });

  it("root has default data-testid='event-card'", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    expect(container.querySelector("[data-testid='event-card']")).not.toBeNull();
  });

  it("root has custom data-testid when provided", () => {
    const { container } = render(
      <EventCard {...MINIMAL} data-testid="my-event" />
    );
    expect(container.querySelector("[data-testid='my-event']")).not.toBeNull();
    expect(container.querySelector("[data-testid='event-card']")).toBeNull();
  });

  it("root has data-event-type attribute matching eventType prop", () => {
    const { container } = render(
      <EventCard eventType="damage_reported" timestamp={TIMESTAMP} />
    );
    const card = container.querySelector("[data-testid='event-card']");
    expect(card?.getAttribute("data-event-type")).toBe("damage_reported");
  });

  it("root has data-variant attribute", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    const card = container.querySelector("[data-testid='event-card']");
    expect(card?.getAttribute("data-variant")).toBeDefined();
  });

  it("root aria-label includes the event type label when label prop is omitted", () => {
    render(<EventCard eventType="shipped" timestamp={TIMESTAMP} />);
    const card = screen.getByRole("article");
    expect(card.getAttribute("aria-label")).toContain("Shipped");
  });

  it("root aria-label includes the label prop when provided", () => {
    render(
      <EventCard {...MINIMAL} label="Custom Event Label" />
    );
    const card = screen.getByRole("article");
    expect(card.getAttribute("aria-label")).toContain("Custom Event Label");
  });

  it("root aria-label includes 'case {caseLabel}' when caseLabel is provided", () => {
    render(<EventCard {...MINIMAL} caseLabel="CS-042" />);
    const card = screen.getByRole("article");
    expect(card.getAttribute("aria-label")).toContain("case CS-042");
  });
});

// ─── Event type label ─────────────────────────────────────────────────────────

describe("EventCard — event type label", () => {
  const SLUG_CASES: Array<[string, string]> = [
    ["status_change",        "Status Changed"],
    ["inspection_started",   "Inspection Started"],
    ["inspection_completed", "Inspection Completed"],
    ["damage_reported",      "Damage Reported"],
    ["shipped",              "Shipped"],
    ["delivered",            "Delivered"],
    ["custody_handoff",      "Custody Handoff"],
    ["mission_assigned",     "Mission Assigned"],
    ["template_applied",     "Template Applied"],
    ["scan_check_in",        "Scan Check-In"],
    ["qr_associated",        "QR Associated"],
  ];

  it.each(SLUG_CASES)(
    'known slug "%s" renders as "%s"',
    (slug, label) => {
      render(<EventCard eventType={slug} timestamp={TIMESTAMP} />);
      const typeEl = screen.getByTestId("event-card-type");
      expect(typeEl.textContent).toBe(label);
    }
  );

  it("unknown slug 'custom_action' falls back to Title Case 'Custom Action'", () => {
    render(<EventCard eventType="custom_action" timestamp={TIMESTAMP} />);
    const typeEl = screen.getByTestId("event-card-type");
    expect(typeEl.textContent).toBe("Custom Action");
  });

  it("multi-word unknown slug 'some_new_event_type' falls back to 'Some New Event Type'", () => {
    render(<EventCard eventType="some_new_event_type" timestamp={TIMESTAMP} />);
    const typeEl = screen.getByTestId("event-card-type");
    expect(typeEl.textContent).toBe("Some New Event Type");
  });

  it("label prop overrides derived event type label", () => {
    render(
      <EventCard
        eventType="status_change"
        timestamp={TIMESTAMP}
        label="Custom Override"
      />
    );
    const typeEl = screen.getByTestId("event-card-type");
    expect(typeEl.textContent).toBe("Custom Override");
    // "Status Changed" should not appear (overridden)
    expect(screen.queryByText("Status Changed")).toBeNull();
  });
});

// ─── Timestamp ────────────────────────────────────────────────────────────────

describe("EventCard — timestamp", () => {
  it("<time> element is present", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    expect(container.querySelector("time")).not.toBeNull();
  });

  it("<time> has dateTime attribute equal to ISO 8601 string", () => {
    const { container } = render(<EventCard {...MINIMAL} timestamp={TIMESTAMP} />);
    const timeEl = container.querySelector("time");
    expect(timeEl?.getAttribute("dateTime")).toBe(TIMESTAMP_ISO);
  });

  it("<time> displays a non-empty human-readable string", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    const timeEl = container.querySelector("time");
    expect((timeEl?.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("data-testid='event-card-timestamp' is on the <time> element", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    const timeEl = container.querySelector("[data-testid='event-card-timestamp']");
    expect(timeEl?.tagName.toLowerCase()).toBe("time");
  });
});

// ─── Status pill ──────────────────────────────────────────────────────────────

describe("EventCard — status pill", () => {
  it("renders a StatusPill when status prop is provided", () => {
    render(<EventCard {...MINIMAL} status="deployed" />);
    // StatusPill renders with role="status"
    const pill = screen.getByRole("status");
    expect(pill).toBeDefined();
    expect(pill.textContent).toContain("Deployed");
  });

  it("does not render a StatusPill when status prop is omitted", () => {
    render(<EventCard {...MINIMAL} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders correct StatusPill for 'flagged' status", () => {
    render(<EventCard {...MINIMAL} status="flagged" />);
    const pill = screen.getByRole("status");
    expect(pill.textContent).toContain("Flagged");
  });

  it("renders correct StatusPill for 'completed' status", () => {
    render(<EventCard {...MINIMAL} status="completed" />);
    const pill = screen.getByRole("status");
    expect(pill.textContent).toContain("Completed");
  });

  it("renders correct StatusPill for 'in_progress' status", () => {
    render(<EventCard {...MINIMAL} status="in_progress" />);
    const pill = screen.getByRole("status");
    expect(pill.textContent).toContain("In Progress");
  });
});

// ─── Case label ───────────────────────────────────────────────────────────────

describe("EventCard — case label", () => {
  it("renders case label when caseLabel prop is provided", () => {
    render(<EventCard {...MINIMAL} caseLabel="CS-042" />);
    const caseLabelEl = screen.getByTestId("event-card-case-label");
    expect(caseLabelEl.textContent).toBe("CS-042");
  });

  it("case label element is absent when caseLabel is not provided", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    expect(
      container.querySelector("[data-testid='event-card-case-label']")
    ).toBeNull();
  });
});

// ─── Actor name ───────────────────────────────────────────────────────────────

describe("EventCard — actor name", () => {
  it("renders actor name when actorName prop is provided", () => {
    render(<EventCard {...MINIMAL} actorName="Alice Tech" />);
    const actorEl = screen.getByTestId("event-card-actor");
    expect(actorEl.textContent).toBe("Alice Tech");
  });

  it("actor name element is absent when actorName is not provided", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    expect(
      container.querySelector("[data-testid='event-card-actor']")
    ).toBeNull();
  });
});

// ─── Detail text ──────────────────────────────────────────────────────────────

describe("EventCard — detail text", () => {
  it("renders detail text when detail prop is provided", () => {
    render(<EventCard {...MINIMAL} detail="12 / 15 items · 2 damaged" />);
    const detailEl = screen.getByTestId("event-card-detail");
    expect(detailEl.textContent).toBe("12 / 15 items · 2 damaged");
  });

  it("detail element is absent when detail is not provided", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    expect(
      container.querySelector("[data-testid='event-card-detail']")
    ).toBeNull();
  });

  it("renders both actor name and detail when both are provided", () => {
    render(
      <EventCard {...MINIMAL} actorName="Bob Pilot" detail="Blade tip crack" />
    );
    expect(screen.getByTestId("event-card-actor").textContent).toBe("Bob Pilot");
    expect(screen.getByTestId("event-card-detail").textContent).toBe("Blade tip crack");
  });

  it("renders detail without actor when only detail is provided", () => {
    render(<EventCard {...MINIMAL} detail="Severe damage" />);
    expect(screen.getByTestId("event-card-detail")).toBeDefined();
    expect(
      screen.queryByTestId("event-card-actor")
    ).toBeNull();
  });
});

// ─── Variant states ───────────────────────────────────────────────────────────

describe("EventCard — variant states", () => {
  const variants: Array<[EventVariant, string]> = [
    ["default",   "default"],
    ["active",    "active"],
    ["completed", "completed"],
    ["flagged",   "flagged"],
  ];

  it.each(variants)(
    "variant='%s' produces data-variant='%s' on root article",
    (variant, expected) => {
      const { container } = render(
        <EventCard {...MINIMAL} variant={variant} />
      );
      const card = container.querySelector("[data-testid='event-card']");
      expect(card?.getAttribute("data-variant")).toBe(expected);
    }
  );

  it("defaults to data-variant='default' when variant prop is omitted", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    const card = container.querySelector("[data-testid='event-card']");
    expect(card?.getAttribute("data-variant")).toBe("default");
  });

  it("flagged variant includes 'flagged' in aria-label when isSelected", () => {
    render(
      <EventCard
        {...MINIMAL}
        variant="flagged"
        onClick={() => undefined}
        isSelected
      />
    );
    const button = screen.getByTestId("event-card-button");
    expect(button.getAttribute("aria-label")).toContain("selected");
  });
});

// ─── Event dot variants ───────────────────────────────────────────────────────

describe("EventCard — event dot variants", () => {
  const DOT_CASES: Array<[string, string]> = [
    ["status_change",        "brand"],
    ["inspection_started",   "transit"],
    ["inspection_completed", "success"],
    ["damage_reported",      "error"],
    ["shipped",              "transit"],
    ["delivered",            "success"],
    ["custody_handoff",      "neutral"],
    ["mission_assigned",     "brand"],
    ["template_applied",     "neutral"],
  ];

  it.each(DOT_CASES)(
    'eventType "%s" produces data-dot-variant="%s"',
    (eventType, dotVariant) => {
      const { container } = render(
        <EventCard eventType={eventType} timestamp={TIMESTAMP} />
      );
      const dot = container.querySelector("[data-dot-variant]");
      expect(dot?.getAttribute("data-dot-variant")).toBe(dotVariant);
    }
  );

  it("unknown event type falls back to dot variant 'neutral'", () => {
    const { container } = render(
      <EventCard eventType="unknown_event_xyz" timestamp={TIMESTAMP} />
    );
    const dot = container.querySelector("[data-dot-variant]");
    expect(dot?.getAttribute("data-dot-variant")).toBe("neutral");
  });

  it("dot element is aria-hidden (decorative)", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    const dot = container.querySelector("[data-dot-variant]");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });
});

// ─── Interactive mode ─────────────────────────────────────────────────────────

describe("EventCard — interactive mode (onClick)", () => {
  it("renders a button wrapper when onClick is provided", () => {
    render(<EventCard {...MINIMAL} onClick={() => undefined} />);
    const button = screen.getByTestId("event-card-button");
    expect(button.tagName.toLowerCase()).toBe("button");
  });

  it("button has type='button'", () => {
    render(<EventCard {...MINIMAL} onClick={() => undefined} />);
    const button = screen.getByTestId("event-card-button");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("calls onClick when the button is clicked", () => {
    const onClick = vi.fn();
    render(<EventCard {...MINIMAL} onClick={onClick} />);
    const button = screen.getByTestId("event-card-button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not render button wrapper when onClick is omitted", () => {
    const { container } = render(<EventCard {...MINIMAL} />);
    expect(
      container.querySelector("[data-testid='event-card-button']")
    ).toBeNull();
  });

  it("button has aria-pressed='false' when isSelected=false (default)", () => {
    render(<EventCard {...MINIMAL} onClick={() => undefined} />);
    const button = screen.getByTestId("event-card-button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("button has aria-pressed='true' when isSelected=true", () => {
    render(
      <EventCard {...MINIMAL} onClick={() => undefined} isSelected={true} />
    );
    const button = screen.getByTestId("event-card-button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("button aria-label includes case label when caseLabel is provided", () => {
    render(
      <EventCard {...MINIMAL} caseLabel="CS-007" onClick={() => undefined} />
    );
    const button = screen.getByTestId("event-card-button");
    expect(button.getAttribute("aria-label")).toContain("case CS-007");
  });

  it("button aria-label includes 'selected' when isSelected=true", () => {
    render(
      <EventCard {...MINIMAL} onClick={() => undefined} isSelected={true} />
    );
    const button = screen.getByTestId("event-card-button");
    expect(button.getAttribute("aria-label")).toContain("selected");
  });
});

// ─── Non-interactive (static) mode ───────────────────────────────────────────

describe("EventCard — static (non-interactive) mode", () => {
  it("article root contains event type content without a button wrapper", () => {
    render(<EventCard {...MINIMAL} />);
    const card = screen.getByRole("article");
    // No button inside
    expect(card.querySelector("button")).toBeNull();
  });

  it("renders all content directly in the article (no button)", () => {
    render(
      <EventCard
        {...MINIMAL}
        caseLabel="CS-001"
        actorName="Jane Pilot"
        detail="Site visit"
        status="deployed"
      />
    );
    // All content elements are accessible in the article
    expect(screen.getByTestId("event-card-type")).toBeDefined();
    expect(screen.getByTestId("event-card-case-label")).toBeDefined();
    expect(screen.getByTestId("event-card-actor")).toBeDefined();
    expect(screen.getByTestId("event-card-detail")).toBeDefined();
    expect(screen.getByRole("status")).toBeDefined();  // StatusPill
  });
});

// ─── className and data-testid props ─────────────────────────────────────────

describe("EventCard — className and data-testid props", () => {
  it("forwards additional className to the root article element", () => {
    const { container } = render(
      <EventCard {...MINIMAL} className="my-extra-class" />
    );
    const root = container.querySelector("[data-testid='event-card']");
    expect(root?.className).toContain("my-extra-class");
  });

  it("forwards data-testid to the root article element", () => {
    const { container } = render(
      <EventCard {...MINIMAL} data-testid="custom-event-card" />
    );
    expect(
      container.querySelector("[data-testid='custom-event-card']")
    ).not.toBeNull();
  });
});

// ─── Full prop combination ────────────────────────────────────────────────────

describe("EventCard — full prop combination", () => {
  it("renders correctly with all props provided", () => {
    const onClick = vi.fn();
    render(
      <EventCard
        eventType="damage_reported"
        timestamp={TIMESTAMP}
        label="Damage Reported"
        status="flagged"
        variant="flagged"
        caseLabel="CS-042"
        actorName="Alice Tech"
        detail="Blade tip crack · Severe"
        onClick={onClick}
        isSelected={false}
        className="full-test-card"
        data-testid="full-test"
      />
    );

    // Article root
    const card = screen.getByRole("article");
    expect(card.getAttribute("data-variant")).toBe("flagged");
    expect(card.getAttribute("data-event-type")).toBe("damage_reported");
    expect(card.className).toContain("full-test-card");

    // Content
    expect(screen.getByTestId("event-card-type").textContent).toBe("Damage Reported");
    expect(screen.getByTestId("event-card-case-label").textContent).toBe("CS-042");
    expect(screen.getByTestId("event-card-actor").textContent).toBe("Alice Tech");
    expect(screen.getByTestId("event-card-detail").textContent).toBe("Blade tip crack · Severe");
    expect(screen.getByRole("status").textContent).toContain("Flagged");

    // Timestamp
    const timeEl = card.querySelector("time");
    expect(timeEl?.getAttribute("dateTime")).toBe(TIMESTAMP_ISO);

    // Interactive button
    const button = screen.getByTestId("event-card-button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
