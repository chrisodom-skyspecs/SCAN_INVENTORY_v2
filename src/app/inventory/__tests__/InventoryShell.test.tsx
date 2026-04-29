/**
 * @vitest-environment jsdom
 *
 * Unit tests: InventoryShell — mobile nav state management and toggle behavior.
 *
 * Tests the collapsible / responsive orchestration layer introduced in Sub-AC 3c:
 *
 *   1.  Nav starts CLOSED by default (mobileNavOpen = false).
 *   2.  AppShell receives data-nav-open="false" on initial render.
 *   3.  A hamburger toggle button is rendered inside the top bar.
 *   4.  The toggle button has aria-expanded="false" initially.
 *   5.  Clicking the toggle opens the nav (data-nav-open="true").
 *   6.  After opening, the toggle button has aria-expanded="true".
 *   7.  The toggle button label changes from "Open" to "Close" when open.
 *   8.  Clicking the toggle again closes the nav.
 *   9.  Clicking the scrim button closes the nav.
 *  10.  Clicking a nav link calls onLinkClick (which closes the nav).
 *  11.  aria-controls on the toggle button references "inventory-side-nav".
 *  12.  The nav element has id="inventory-side-nav".
 *
 * CSS media-query behaviour (collapsed at ≤ 768px) is tested at the CSS level
 * and cannot be asserted in jsdom.  These tests cover the JS state layer.
 */

import React from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// next/navigation — InventorySideNav uses usePathname + useSearchParams
vi.mock("next/navigation", () => ({
  usePathname: () => "/inventory",
  useSearchParams: () => ({
    get: (_key: string) => null,
  }),
}));

// next/link — render as plain <a>
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

// Kinde auth — InventoryNavbar uses useKindeBrowserClient
vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: () => ({
    user: {
      given_name: "Test",
      family_name: "User",
      email: "test@skyspecs.com",
    },
  }),
}));

// Kinde components — LogoutLink
vi.mock("@kinde-oss/kinde-auth-nextjs/components", () => ({
  LogoutLink: ({
    children,
    ...rest
  }: { children: React.ReactNode; [key: string]: unknown }) => (
    <a href="/api/auth/logout" {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </a>
  ),
}));

// Convex hooks — ConnectionIndicator + NotificationBell deps
vi.mock("convex/react", () => ({
  useConvexConnectionState: () => ({
    isWebSocketConnected: true,
    hasEverConnected: true,
    connectionRetries: 0,
    connectionCount: 1,
    hasInflightRequests: false,
    timeOfOldestInflightRequest: null,
  }),
  useQuery: () => undefined,
  useMutation: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({
    unreadCount: 0,
    notifications: [],
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
  }),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { InventoryShell } from "../InventoryShell";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderShell(children?: React.ReactNode) {
  return render(
    <InventoryShell>{children ?? <div data-testid="content">content</div>}</InventoryShell>,
  );
}

afterEach(() => {
  cleanup();
});

// ─── Initial state ────────────────────────────────────────────────────────────

describe("InventoryShell — initial state (nav closed by default)", () => {
  it("renders the shell without crashing", () => {
    renderShell();
    // The AppShell root is the application region
    const app = screen.getByRole("application", { name: /inventory dashboard/i });
    expect(app).toBeTruthy();
  });

  it("sets data-nav-open='false' on the shell initially", () => {
    renderShell();
    const app = screen.getByRole("application", { name: /inventory dashboard/i });
    expect(app.getAttribute("data-nav-open")).toBe("false");
  });

  it("renders the side nav element with id='inventory-side-nav'", () => {
    renderShell();
    const nav = document.getElementById("inventory-side-nav");
    expect(nav).toBeTruthy();
    expect(nav?.tagName.toLowerCase()).toBe("nav");
  });

  it("renders the hamburger toggle button", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    expect(toggle).toBeTruthy();
  });

  it("toggle button starts with aria-expanded='false'", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggle button has aria-controls='inventory-side-nav'", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    expect(toggle.getAttribute("aria-controls")).toBe("inventory-side-nav");
  });
});

// ─── Toggle behavior ──────────────────────────────────────────────────────────

describe("InventoryShell — toggle opens and closes the nav", () => {
  it("opens the nav when the toggle button is clicked", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    fireEvent.click(toggle);

    const app = screen.getByRole("application", { name: /inventory dashboard/i });
    expect(app.getAttribute("data-nav-open")).toBe("true");
  });

  it("sets aria-expanded='true' on the toggle after opening", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    fireEvent.click(toggle);

    // After open, button label changes to "Close navigation menu"
    const openToggle = screen.getByRole("button", { name: /close navigation menu/i });
    expect(openToggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the nav when the toggle is clicked again", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });

    // open
    fireEvent.click(toggle);
    expect(
      screen.getByRole("application").getAttribute("data-nav-open"),
    ).toBe("true");

    // close
    const closeToggle = screen.getByRole("button", { name: /close navigation menu/i });
    fireEvent.click(closeToggle);

    expect(
      screen.getByRole("application").getAttribute("data-nav-open"),
    ).toBe("false");
  });

  it("toggle label is 'Open navigation menu' when nav is closed", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /open navigation menu/i })).toBeTruthy();
  });

  it("toggle label is 'Close navigation menu' when nav is open", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));
    expect(screen.getByRole("button", { name: /close navigation menu/i })).toBeTruthy();
  });
});

// ─── Scrim closes the nav ─────────────────────────────────────────────────────

describe("InventoryShell — scrim click closes the nav", () => {
  it("closes the nav when the scrim button is clicked", () => {
    renderShell();

    // Open the nav first
    fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));
    expect(
      screen.getByRole("application").getAttribute("data-nav-open"),
    ).toBe("true");

    // The scrim is an aria-hidden button with label "Close navigation"
    // It's rendered by AppShell when mobileNavOpen=true
    const scrim = screen.getByRole("button", { name: /close navigation/i, hidden: true });
    fireEvent.click(scrim);

    expect(
      screen.getByRole("application").getAttribute("data-nav-open"),
    ).toBe("false");
  });
});

// ─── Nav link click closes the drawer ────────────────────────────────────────

describe("InventoryShell — nav link click closes the mobile drawer", () => {
  it("closes the nav when a primary nav link is clicked", () => {
    renderShell();

    // Open nav first
    fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));
    expect(
      screen.getByRole("application").getAttribute("data-nav-open"),
    ).toBe("true");

    // Click a nav link — e.g. Fleet Overview (M1)
    const m1Link = screen.getByRole("link", { name: /fleet overview/i });
    fireEvent.click(m1Link);

    expect(
      screen.getByRole("application").getAttribute("data-nav-open"),
    ).toBe("false");
  });

  it("closes the nav when a secondary nav link is clicked", () => {
    renderShell();

    // Open nav first
    fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));

    // Click the Cases link
    const casesLink = screen.getByRole("link", { name: /cases/i });
    fireEvent.click(casesLink);

    expect(
      screen.getByRole("application").getAttribute("data-nav-open"),
    ).toBe("false");
  });
});

// ─── Children rendered ────────────────────────────────────────────────────────

describe("InventoryShell — children rendered in main region", () => {
  it("renders children inside the main content area", () => {
    renderShell(<div data-testid="page-content">Hello</div>);
    const content = screen.getByTestId("page-content");
    expect(content).toBeTruthy();
    expect(content.textContent).toBe("Hello");
  });
});
