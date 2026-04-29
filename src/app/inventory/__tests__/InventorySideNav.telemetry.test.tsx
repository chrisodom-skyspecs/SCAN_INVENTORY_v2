/**
 * @vitest-environment jsdom
 *
 * Unit tests: InventorySideNav — navigation / route-change telemetry.
 *
 * Verifies that clicking nav links fires the appropriate telemetry events:
 *   • Map mode links  → INV_NAV_MAP_VIEW_CHANGED
 *   • Utility links   → INV_NAV_PAGE_LOADED
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at the module level so we can assert on exactly
 *   which events were emitted without touching any transport.
 * • `next/navigation` and `next/link` are mocked as in the base test.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Clicking a map mode link (e.g. M1) fires INV_NAV_MAP_VIEW_CHANGED.
 * 2. Fired event has correct mapView value for each mode (M1-M4).
 * 3. The event has eventCategory="navigation" and app="inventory".
 * 4. Clicking a utility link (Cases, Reports, Admin) fires INV_NAV_PAGE_LOADED.
 * 5. The onLinkClick callback is STILL called after the telemetry event fires.
 * 6. Clicking a map mode link does NOT fire INV_NAV_PAGE_LOADED.
 * 7. Clicking a utility link does NOT fire INV_NAV_MAP_VIEW_CHANGED.
 */

import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Mock telemetry (spy on trackEvent, never hit transport) ──────────────────

const mockTrackEvent = vi.fn();

vi.mock("@/lib/telemetry.lib", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  telemetry: {
    track: vi.fn(),
    identify: vi.fn(),
    flush: vi.fn(),
  },
}));

// ─── Mock next/navigation ─────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  usePathname: () => "/inventory",
  useSearchParams: () => ({
    get: (key: string) => (key === "view" ? "M1" : null),
  }),
}));

// ─── Mock next/link ───────────────────────────────────────────────────────────

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    "data-active": dataActive,
    "aria-current": ariaCurrent,
    title,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "data-active"?: string;
    "aria-current"?: React.AriaAttributes["aria-current"];
    title?: string;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    [key: string]: unknown;
  }) => (
    <a
      href={href}
      className={className}
      data-active={dataActive}
      aria-current={ariaCurrent}
      title={title}
      onClick={onClick}
      {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
    >
      {children}
    </a>
  ),
}));

// ─── Module under test (after all mocks are registered) ──────────────────────

import { InventorySideNav } from "../InventorySideNav";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderSideNav(props?: React.ComponentProps<typeof InventorySideNav>) {
  return render(<InventorySideNav {...props} />);
}

function callsForEvent(eventName: string): Record<string, unknown>[] {
  return mockTrackEvent.mock.calls
    .map((args: unknown[]) => args[0] as Record<string, unknown>)
    .filter((e) => e.eventName === eventName);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  mockTrackEvent.mockClear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InventorySideNav — map mode navigation telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  // ─── 1. Clicking M1 fires INV_NAV_MAP_VIEW_CHANGED with mapView="M1" ─────

  it("fires INV_NAV_MAP_VIEW_CHANGED with mapView='M1' when Fleet Overview is clicked", () => {
    renderSideNav();
    const m1Link = screen.getByRole("link", { name: /fleet overview/i });
    fireEvent.click(m1Link);

    const events = callsForEvent(TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0].mapView).toBe("M1");
  });

  it("fires INV_NAV_MAP_VIEW_CHANGED with mapView='M2' when Site Detail is clicked", () => {
    renderSideNav();
    const m2Link = screen.getByRole("link", { name: /site detail/i });
    fireEvent.click(m2Link);

    const events = callsForEvent(TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0].mapView).toBe("M2");
  });

  it("fires INV_NAV_MAP_VIEW_CHANGED with mapView='M3' when Transit is clicked", () => {
    renderSideNav();
    const m3Link = screen.getByRole("link", { name: /transit/i });
    fireEvent.click(m3Link);

    const events = callsForEvent(TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0].mapView).toBe("M3");
  });

  it("fires INV_NAV_MAP_VIEW_CHANGED with mapView='M4' when Deployment is clicked", () => {
    renderSideNav();
    const m4Link = screen.getByRole("link", { name: /deployment/i });
    fireEvent.click(m4Link);

    const events = callsForEvent(TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0].mapView).toBe("M4");
  });

  // ─── 2. Event has required shape fields ───────────────────────────────────

  it("fired event has eventCategory='navigation' and app='inventory'", () => {
    renderSideNav();
    const m2Link = screen.getByRole("link", { name: /site detail/i });
    fireEvent.click(m2Link);

    const events = callsForEvent(TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0].eventCategory).toBe("navigation");
    expect(events[0].app).toBe("inventory");
  });

  // ─── 5. onLinkClick callback is still called ─────────────────────────────

  it("still calls onLinkClick after firing the telemetry event", () => {
    const onLinkClick = vi.fn();
    renderSideNav({ onLinkClick });

    const m1Link = screen.getByRole("link", { name: /fleet overview/i });
    fireEvent.click(m1Link);

    // Both telemetry and the callback should have fired
    const events = callsForEvent(TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);
    expect(events).toHaveLength(1);
    expect(onLinkClick).toHaveBeenCalledOnce();
  });

  // ─── 6. Map mode click does NOT fire INV_NAV_PAGE_LOADED ─────────────────

  it("does NOT fire INV_NAV_PAGE_LOADED when a map mode link is clicked", () => {
    renderSideNav();
    const m1Link = screen.getByRole("link", { name: /fleet overview/i });
    fireEvent.click(m1Link);

    const pageLoadedEvents = callsForEvent(TelemetryEventName.INV_NAV_PAGE_LOADED);
    expect(pageLoadedEvents).toHaveLength(0);
  });
});

describe("InventorySideNav — utility route navigation telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  // ─── 4. Clicking utility links fires INV_NAV_PAGE_LOADED ─────────────────

  it("fires INV_NAV_PAGE_LOADED when Cases link is clicked", () => {
    renderSideNav();
    const casesLink = screen.getByRole("link", { name: /cases/i });
    fireEvent.click(casesLink);

    const events = callsForEvent(TelemetryEventName.INV_NAV_PAGE_LOADED);
    expect(events).toHaveLength(1);
    expect(events[0].eventCategory).toBe("navigation");
    expect(events[0].app).toBe("inventory");
  });

  it("fires INV_NAV_PAGE_LOADED when Reports link is clicked", () => {
    renderSideNav();
    const reportsLink = screen.getByRole("link", { name: /reports/i });
    fireEvent.click(reportsLink);

    const events = callsForEvent(TelemetryEventName.INV_NAV_PAGE_LOADED);
    expect(events).toHaveLength(1);
  });

  it("fires INV_NAV_PAGE_LOADED when Admin link is clicked", () => {
    renderSideNav();
    const adminLink = screen.getByRole("link", { name: /admin/i });
    fireEvent.click(adminLink);

    const events = callsForEvent(TelemetryEventName.INV_NAV_PAGE_LOADED);
    expect(events).toHaveLength(1);
  });

  // ─── 5. onLinkClick callback is still called ─────────────────────────────

  it("still calls onLinkClick after firing the telemetry event for utility routes", () => {
    const onLinkClick = vi.fn();
    renderSideNav({ onLinkClick });

    const casesLink = screen.getByRole("link", { name: /cases/i });
    fireEvent.click(casesLink);

    const events = callsForEvent(TelemetryEventName.INV_NAV_PAGE_LOADED);
    expect(events).toHaveLength(1);
    expect(onLinkClick).toHaveBeenCalledOnce();
  });

  // ─── 7. Utility route click does NOT fire INV_NAV_MAP_VIEW_CHANGED ────────

  it("does NOT fire INV_NAV_MAP_VIEW_CHANGED when a utility link is clicked", () => {
    renderSideNav();
    const casesLink = screen.getByRole("link", { name: /cases/i });
    fireEvent.click(casesLink);

    const mapViewEvents = callsForEvent(TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);
    expect(mapViewEvents).toHaveLength(0);
  });
});
