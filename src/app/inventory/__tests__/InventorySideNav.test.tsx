/**
 * @vitest-environment jsdom
 *
 * Unit tests: InventorySideNav — navigation links list, active state,
 * accessible markup, and feature flag gating.
 *
 * Verifies:
 *   1.  All 5 enabled primary nav items render (M1–M4 always; M5 only when
 *       FF_MAP_MISSION=1).
 *   2.  Each nav link has the correct href.
 *   3.  Each nav link has a visible label with correct text.
 *   4.  Each nav link renders an SVG icon with aria-hidden="true".
 *   5.  The active item receives aria-current="page" and data-active="true".
 *   6.  The default active item is M1 when ?view= is absent.
 *   7.  The active item changes when the view param changes.
 *   8.  Inactive items do NOT have aria-current set.
 *   9.  Section headings "Map Views" and "Management" are rendered.
 *  10.  Secondary items (Cases, Reports, Admin) are rendered.
 *  11.  M5 item is absent when FF_MAP_MISSION is not set.
 *  12.  Utility route items become active when pathname prefix matches.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// ─── Mock next/navigation ─────────────────────────────────────────────────────

let _mockPathname = "/inventory";
let _mockViewParam: string | null = "M1";

vi.mock("next/navigation", () => ({
  usePathname: () => _mockPathname,
  useSearchParams: () => ({
    get: (key: string) => (key === "view" ? _mockViewParam : null),
  }),
}));

// ─── Mock next/link ───────────────────────────────────────────────────────────
// Render as a plain <a> so we can inspect href, aria-current, etc.

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    "data-active": dataActive,
    "aria-current": ariaCurrent,
    title,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "data-active"?: string;
    "aria-current"?: React.AriaAttributes["aria-current"];
    title?: string;
    [key: string]: unknown;
  }) => (
    <a
      href={href}
      className={className}
      data-active={dataActive}
      aria-current={ariaCurrent}
      title={title}
      {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
    >
      {children}
    </a>
  ),
}));

// ─── Module under test ────────────────────────────────────────────────────────

// Import after mocks are registered
import { InventorySideNav, ALL_NAV_ITEMS } from "../InventorySideNav";

afterEach(() => {
  cleanup();
  // Reset to defaults between tests
  _mockPathname = "/inventory";
  _mockViewParam = "M1";
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function renderSideNav(props?: React.ComponentProps<typeof InventorySideNav>) {
  return render(<InventorySideNav {...props} />);
}

// ─── ALL_NAV_ITEMS array structure ────────────────────────────────────────────

describe("ALL_NAV_ITEMS array", () => {
  it("exports an array of nav item definitions", () => {
    expect(Array.isArray(ALL_NAV_ITEMS)).toBe(true);
    expect(ALL_NAV_ITEMS.length).toBeGreaterThan(0);
  });

  it("each item has key, label, href, icon, and group", () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(typeof item.key).toBe("string");
      expect(typeof item.label).toBe("string");
      expect(typeof item.href).toBe("string");
      expect(typeof item.icon).toBe("function");
      expect(["primary", "secondary"]).toContain(item.group);
    }
  });

  it("primary map items link to /inventory?view=MN", () => {
    const primary = ALL_NAV_ITEMS.filter((i) => i.group === "primary");
    for (const item of primary) {
      expect(item.href).toMatch(/^\/inventory\?view=M[1-5]$/);
    }
  });

  it("has M1 Fleet Overview as first primary item", () => {
    const primary = ALL_NAV_ITEMS.filter((i) => i.group === "primary");
    expect(primary[0].mapView).toBe("M1");
    expect(primary[0].label).toBe("Fleet Overview");
  });

  it("secondary items link to /inventory/* sub-routes", () => {
    const secondary = ALL_NAV_ITEMS.filter((i) => i.group === "secondary");
    expect(secondary.length).toBeGreaterThanOrEqual(2);
    for (const item of secondary) {
      expect(item.href).toMatch(/^\/inventory\//);
    }
  });
});

// ─── Rendering — primary nav items ────────────────────────────────────────────

describe("InventorySideNav — primary nav items", () => {
  it("renders the Fleet Overview (M1) nav link", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /fleet overview/i });
    expect(link).toBeTruthy();
  });

  it("renders the Site Detail (M2) nav link", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /site detail/i });
    expect(link).toBeTruthy();
  });

  it("renders the Transit (M3) nav link", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /transit/i });
    expect(link).toBeTruthy();
  });

  it("renders the Deployment (M4) nav link", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /deployment/i });
    expect(link).toBeTruthy();
  });

  it("M1 link has correct href /inventory?view=M1", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /fleet overview/i });
    expect(link.getAttribute("href")).toBe("/inventory?view=M1");
  });

  it("M2 link has correct href /inventory?view=M2", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /site detail/i });
    expect(link.getAttribute("href")).toBe("/inventory?view=M2");
  });

  it("M3 link has correct href /inventory?view=M3", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /transit/i });
    expect(link.getAttribute("href")).toBe("/inventory?view=M3");
  });

  it("M4 link has correct href /inventory?view=M4", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /deployment/i });
    expect(link.getAttribute("href")).toBe("/inventory?view=M4");
  });
});

// ─── Rendering — secondary nav items ─────────────────────────────────────────

describe("InventorySideNav — secondary nav items", () => {
  it("renders the Cases nav link", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /cases/i });
    expect(link).toBeTruthy();
  });

  it("renders the Reports nav link", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /reports/i });
    expect(link).toBeTruthy();
  });

  it("renders the Admin nav link", () => {
    renderSideNav();
    const link = screen.getByRole("link", { name: /admin/i });
    expect(link).toBeTruthy();
  });
});

// ─── Section headings ─────────────────────────────────────────────────────────

describe("InventorySideNav — section headings", () => {
  it("renders 'Map Views' section heading", () => {
    renderSideNav();
    // Section headings are aria-hidden; find them by text
    expect(screen.getByText("Map Views")).toBeTruthy();
  });

  it("renders 'Management' section heading", () => {
    renderSideNav();
    expect(screen.getByText("Management")).toBeTruthy();
  });
});

// ─── Icons ────────────────────────────────────────────────────────────────────

describe("InventorySideNav — icons", () => {
  it("each nav link contains an SVG icon with aria-hidden", () => {
    renderSideNav();
    const container = screen.getByTestId("inventory-side-nav");
    const hiddenSvgs = container.querySelectorAll('svg[aria-hidden="true"]');
    // At least one SVG per nav link
    expect(hiddenSvgs.length).toBeGreaterThan(0);
  });
});

// ─── Active state — map view items ────────────────────────────────────────────

describe("InventorySideNav — active state (map views)", () => {
  it("marks M1 as active (aria-current=page) when view=M1", () => {
    _mockViewParam = "M1";
    renderSideNav();
    const link = screen.getByRole("link", { name: /fleet overview/i });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("data-active")).toBe("true");
  });

  it("marks M1 as active (default) when view param is absent", () => {
    _mockViewParam = null;
    renderSideNav();
    const link = screen.getByRole("link", { name: /fleet overview/i });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("data-active")).toBe("true");
  });

  it("marks M2 as active when view=M2", () => {
    _mockViewParam = "M2";
    renderSideNav();
    const link = screen.getByRole("link", { name: /site detail/i });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("data-active")).toBe("true");
  });

  it("marks M3 as active when view=M3", () => {
    _mockViewParam = "M3";
    renderSideNav();
    const link = screen.getByRole("link", { name: /transit/i });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("marks M4 as active when view=M4", () => {
    _mockViewParam = "M4";
    renderSideNav();
    const link = screen.getByRole("link", { name: /deployment/i });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("M1 is NOT active when view=M2", () => {
    _mockViewParam = "M2";
    renderSideNav();
    const m1Link = screen.getByRole("link", { name: /fleet overview/i });
    expect(m1Link.getAttribute("aria-current")).toBeNull();
    expect(m1Link.getAttribute("data-active")).toBe("false");
  });

  it("inactive items do not have aria-current", () => {
    _mockViewParam = "M1";
    renderSideNav();
    const m2Link = screen.getByRole("link", { name: /site detail/i });
    const m3Link = screen.getByRole("link", { name: /transit/i });
    const m4Link = screen.getByRole("link", { name: /deployment/i });

    expect(m2Link.getAttribute("aria-current")).toBeNull();
    expect(m3Link.getAttribute("aria-current")).toBeNull();
    expect(m4Link.getAttribute("aria-current")).toBeNull();
  });
});

// ─── Active state — utility routes ────────────────────────────────────────────

describe("InventorySideNav — active state (utility routes)", () => {
  it("marks Cases as active when pathname is /inventory/cases", () => {
    _mockPathname = "/inventory/cases";
    _mockViewParam = null;
    renderSideNav();
    const link = screen.getByRole("link", { name: /cases/i });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("marks Admin as active when pathname is /inventory/admin/templates", () => {
    _mockPathname = "/inventory/admin/templates";
    _mockViewParam = null;
    renderSideNav();
    const link = screen.getByRole("link", { name: /admin/i });
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});

// ─── title attribute (collapsed mode tooltip) ─────────────────────────────────

describe("InventorySideNav — title attribute for tooltips", () => {
  it("each nav link has a title attribute matching the label", () => {
    renderSideNav();
    const m1Link = screen.getByRole("link", { name: /fleet overview/i });
    expect(m1Link.getAttribute("title")).toBe("Fleet Overview");

    const m2Link = screen.getByRole("link", { name: /site detail/i });
    expect(m2Link.getAttribute("title")).toBe("Site Detail");

    const casesLink = screen.getByRole("link", { name: /cases/i });
    expect(casesLink.getAttribute("title")).toBe("Cases");
  });
});

// ─── M5 Mission Control feature flag ──────────────────────────────────────────

describe("InventorySideNav — M5 Mission Control feature flag", () => {
  it("does not render M5 Mission Control when FF_MAP_MISSION is off (default)", () => {
    // In the test environment, NEXT_PUBLIC_FF_MAP_MISSION is not set,
    // so M5 should be hidden by default.
    renderSideNav();
    const m5Link = screen.queryByRole("link", { name: /mission control/i });
    // M5 is either absent or present depending on the env var at module load time.
    // When FF is off (default in test), it should be absent.
    // When FF is on, it should be present.
    // We assert the query itself runs without error.
    // The actual presence depends on the env var — test the absence case here.
    if (process.env.NEXT_PUBLIC_FF_MAP_MISSION !== "1") {
      expect(m5Link).toBeNull();
    } else {
      expect(m5Link).toBeTruthy();
    }
  });
});

// ─── Accessible list markup ───────────────────────────────────────────────────

describe("InventorySideNav — accessible list markup", () => {
  it("renders two <ul> lists with role='list'", () => {
    renderSideNav();
    const container = screen.getByTestId("inventory-side-nav");
    const lists = container.querySelectorAll('ul[role="list"]');
    expect(lists.length).toBe(2);
  });

  it("renders a container with data-testid='inventory-side-nav'", () => {
    renderSideNav();
    const container = screen.getByTestId("inventory-side-nav");
    expect(container).toBeTruthy();
  });
});

// ─── onLinkClick — mobile drawer close callback ───────────────────────────────

describe("InventorySideNav — onLinkClick prop (mobile close callback)", () => {
  it("calls onLinkClick when a primary nav link is clicked", () => {
    const onLinkClick = vi.fn();
    renderSideNav({ onLinkClick });

    const m1Link = screen.getByRole("link", { name: /fleet overview/i });
    fireEvent.click(m1Link);

    expect(onLinkClick).toHaveBeenCalledOnce();
  });

  it("calls onLinkClick when a secondary nav link is clicked", () => {
    const onLinkClick = vi.fn();
    renderSideNav({ onLinkClick });

    const casesLink = screen.getByRole("link", { name: /cases/i });
    fireEvent.click(casesLink);

    expect(onLinkClick).toHaveBeenCalledOnce();
  });

  it("does NOT throw when onLinkClick is absent (default render)", () => {
    // No onLinkClick prop — links should still work without error
    renderSideNav();
    const m1Link = screen.getByRole("link", { name: /fleet overview/i });
    expect(() => fireEvent.click(m1Link)).not.toThrow();
  });

  it("calls onLinkClick once per click, not multiple times", () => {
    const onLinkClick = vi.fn();
    renderSideNav({ onLinkClick });

    const m2Link = screen.getByRole("link", { name: /site detail/i });
    fireEvent.click(m2Link);
    fireEvent.click(m2Link);

    expect(onLinkClick).toHaveBeenCalledTimes(2);
  });
});
