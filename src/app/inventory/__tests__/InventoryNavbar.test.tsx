/**
 * @vitest-environment jsdom
 *
 * Unit tests: InventoryNavbar — logo, global search input, and user avatar dropdown.
 *
 * Verifies:
 *   1.  SkySpecs logomark SVG is rendered on the left.
 *   2.  "SkySpecs" text wordmark is present ("Sky" + "Specs").
 *   3.  "INVENTORY" product badge is visible.
 *   4.  User initials are derived correctly from given/family name.
 *   5.  Avatar trigger button is present with correct ARIA attributes.
 *   6.  Clicking the trigger opens the dropdown.
 *   7.  Dropdown contains user name and email.
 *   8.  Dropdown contains a logout element.
 *   9.  Pressing Escape closes the dropdown.
 *  10.  Clicking outside closes the dropdown.
 *  11.  Falls back to email initials when name is absent.
 *  12.  Global search input is rendered with correct placeholder + aria-label.
 *  13.  cmd-K (metaKey+k) focuses the search input.
 *  14.  Ctrl+K (ctrlKey+k) focuses the search input.
 *  15.  kbd hint element is present inside the search wrapper.
 *  16.  cmd-K calls preventDefault to suppress browser default behaviour.
 */

import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Mock Kinde auth (browser client) ────────────────────────────────────────

const mockUseKindeBrowserClient = vi.fn(() => ({
  user: {
    given_name: "Jane",
    family_name: "Smith",
    email: "jane.smith@skyspecs.com",
  },
}));

vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: () => mockUseKindeBrowserClient(),
}));

// ─── Mock Kinde components ────────────────────────────────────────────────────

vi.mock("@kinde-oss/kinde-auth-nextjs/components", () => ({
  LogoutLink: ({
    children,
    className,
    role,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    className?: string;
    role?: string;
    "aria-label"?: string;
  }) => (
    <a
      href="/api/auth/logout"
      className={className}
      role={role}
      aria-label={ariaLabel}
      data-testid="logout-link"
    >
      {children}
    </a>
  ),
}));

// ─── Mock Convex hooks (ConnectionIndicator + NotificationBell deps) ──────────
//
// ConnectionIndicator calls useConvexConnectionState() from "convex/react".
// NotificationBell calls useQuery() and useMutation() from "convex/react"
// via the useNotifications() hook.
//
// These are mocked to stub values so the InventoryNavbar renders without a
// ConvexProvider wrapper in tests.  The new component behaviour is tested
// in dedicated component tests.

vi.mock("convex/react", () => ({
  useConvexConnectionState: () => ({
    isWebSocketConnected: true,
    hasEverConnected: true,
    connectionRetries: 0,
    connectionCount: 1,
    hasInflightRequests: false,
    timeOfOldestInflightRequest: null,
  }),
  useQuery: (_api: unknown, _args: unknown) => undefined,
  useMutation: (_api: unknown) => vi.fn().mockResolvedValue(undefined),
}));

// Mock the useNotifications hook so NotificationBell doesn't try to hit Convex
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({
    unreadCount: 0,
    notifications: [],
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
  }),
}));

// ─── Mock ThemeToggle ─────────────────────────────────────────────────────────
//
// ThemeToggle calls useThemeContext() which requires ThemeProvider in the tree.
// Mocked to a simple button that avoids the provider dependency in navbar tests.
// Dedicated ThemeToggle tests live in src/components/ThemeToggle/__tests__.

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: ({ className }: { className?: string }) => (
    <button
      type="button"
      className={className}
      data-testid="theme-toggle-mock"
      aria-label="Switch to dark mode"
    >
      Theme
    </button>
  ),
}));

// ─── Mock GlobalSearchModal ───────────────────────────────────────────────────
//
// Mocked to return a minimal testable div when isOpen=true, null when closed.
// This avoids ReactDOM.createPortal and isMounted/isVisible async complexity.
// The InventoryNavbar passes isOpen and onClose; we verify shared state via
// aria-expanded on the trigger button and testid presence.

vi.mock("@/components/GlobalSearchModal", () => ({
  GlobalSearchModal: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div
        data-testid="global-search-modal-mock"
        role="dialog"
        aria-modal="true"
        aria-label="Global case search"
      >
        <button
          type="button"
          onClick={onClose}
          data-testid="mock-search-close"
        >
          Close search
        </button>
      </div>
    ) : null,
}));

// ─── Mock telemetry ───────────────────────────────────────────────────────────
//
// trackEvent is called by handleSearchSubmit in InventoryNavbar.
// Mocked to a no-op to keep tests free of side-effects.

vi.mock("@/lib/telemetry.lib", () => ({
  trackEvent: vi.fn(),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { InventoryNavbar } from "../InventoryNavbar";

// Cleanup the DOM after every test to prevent cross-test contamination.
afterEach(() => {
  cleanup();
  mockUseKindeBrowserClient.mockClear();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderNavbar(props?: React.ComponentProps<typeof InventoryNavbar>) {
  return render(<InventoryNavbar {...props} />);
}

// ─── Logo / wordmark ─────────────────────────────────────────────────────────

describe("InventoryNavbar — logo and wordmark", () => {
  it("renders the SkySpecs logomark SVG with aria-hidden", () => {
    renderNavbar();
    const nav = screen.getByRole("navigation", { name: /inventory main navigation/i });
    const hiddenSvgs = nav.querySelectorAll('svg[aria-hidden="true"]');
    expect(hiddenSvgs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders 'Sky' in the wordmark", () => {
    renderNavbar();
    expect(screen.getAllByText("Sky").length).toBeGreaterThanOrEqual(1);
  });

  it("renders 'Specs' in the wordmark", () => {
    renderNavbar();
    expect(screen.getAllByText("Specs").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the INVENTORY product badge", () => {
    renderNavbar();
    const badge = screen.getByLabelText("INVENTORY");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("INVENTORY");
  });

  it("renders the nav with main navigation role", () => {
    renderNavbar();
    const nav = screen.getByRole("navigation", { name: /inventory main navigation/i });
    expect(nav).toBeTruthy();
  });
});

// ─── Avatar trigger button ────────────────────────────────────────────────────

describe("InventoryNavbar — avatar trigger button", () => {
  it("renders a button with aria-haspopup='menu'", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu for jane s\./i });
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("shows user initials JS (Jane Smith) inside the trigger", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    expect(trigger.textContent).toContain("JS");
  });

  it("starts with aria-expanded='false'", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows display name 'Jane S.' next to the avatar", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    expect(trigger.textContent).toContain("Jane S.");
  });
});

// ─── Dropdown open / close ────────────────────────────────────────────────────

describe("InventoryNavbar — dropdown open/close", () => {
  it("opens the dropdown when the trigger is clicked", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: /user menu/i });
    expect(menu).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the user display name in the dropdown header", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    fireEvent.click(trigger);

    // The dropdown header contains "Jane S." again (in addition to the trigger)
    const instances = screen.getAllByText("Jane S.");
    expect(instances.length).toBeGreaterThanOrEqual(2);
  });

  it("shows the user's email in the dropdown header", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    fireEvent.click(trigger);

    const emailEl = screen.getByText("jane.smith@skyspecs.com");
    expect(emailEl).toBeTruthy();
  });

  it("renders a logout link inside the dropdown", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    fireEvent.click(trigger);

    const logoutEl = screen.getByTestId("logout-link");
    expect(logoutEl).toBeTruthy();
  });

  it("closes the dropdown on Escape key", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the dropdown on click outside", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when trigger is clicked again (toggle off)", () => {
    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// ─── Fallback initials ────────────────────────────────────────────────────────

describe("InventoryNavbar — fallback initials", () => {
  it("uses first char of email when name is absent", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseKindeBrowserClient.mockReturnValueOnce({
      user: { given_name: undefined, family_name: undefined, email: "ops@skyspecs.com" },
    } as any);

    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    // Initial of "ops@skyspecs.com" → "O"
    expect(trigger.textContent).toContain("O");
  });

  it("shows '?' when user is null", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseKindeBrowserClient.mockReturnValueOnce({ user: null } as any);

    renderNavbar();
    const trigger = screen.getByRole("button", { name: /user menu/i });
    expect(trigger.textContent).toContain("?");
  });
});

// ─── Search trigger button ────────────────────────────────────────────────────
//
// The center slot in the navbar renders a button styled to resemble a search
// input field.  Clicking it opens the GlobalSearchModal overlay.  The actual
// search input lives inside the modal, not inline in the navbar.
//
// Verifies:
//   1.  A trigger button with aria-label="Search cases" is rendered.
//   2.  The button has aria-haspopup="dialog" (signals it opens a dialog).
//   3.  The button starts with aria-expanded="false" (modal closed by default).
//   4.  The button has data-open="false" by default.
//   5.  A <kbd> hint element is present inside the trigger button.
//   6.  Clicking the button sets aria-expanded="true".
//   7.  Clicking the button causes GlobalSearchModal to render (isOpen=true).
//   8.  Closing the modal via onClose sets aria-expanded back to "false".

describe("InventoryNavbar — search trigger button", () => {
  it("renders a search trigger button with aria-label 'Search cases'", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });
    expect(btn).toBeTruthy();
  });

  it("search trigger button has aria-haspopup='dialog'", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("search trigger button starts with aria-expanded='false' (modal closed by default)", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("search trigger button has data-open='false' by default", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });
    expect(btn.getAttribute("data-open")).toBe("false");
  });

  it("renders a kbd hint element inside the search trigger button", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });
    const kbdElements = btn.querySelectorAll("kbd");
    expect(kbdElements.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking the trigger button sets aria-expanded='true' on the button", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    fireEvent.click(btn);

    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking the trigger button renders the GlobalSearchModal (isOpen=true)", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    // Modal should not be present before clicking
    expect(screen.queryByTestId("global-search-modal-mock")).toBeNull();

    fireEvent.click(btn);

    // Modal should be present after clicking
    expect(screen.getByTestId("global-search-modal-mock")).toBeTruthy();
  });

  it("closing the modal via onClose sets aria-expanded back to 'false'", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    // Open via button click
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    // Close via the mocked modal's close button (calls onClose → closeSearchModal)
    const closeBtn = screen.getByTestId("mock-search-close");
    fireEvent.click(closeBtn);

    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("global-search-modal-mock")).toBeNull();
  });
});

// ─── Search open state — button and cmd-K share the same state ────────────────
//
// Sub-AC 3: Wire the top bar search trigger button to the same open state so
// both cmd-K and the button open the modal.
//
// Both triggers write to the same `isSearchModalOpen` state via:
//   • Button click  → openSearchModal()  → isSearchModalOpenRef=true, setState=true
//   • cmd-K handler → toggles via ref   → isSearchModalOpenRef=!prev, setState=!prev
//
// The shared ref (isSearchModalOpenRef) ensures the keyboard toggle always reads
// the most-recently-committed state whether the button or keyboard was last to act.
//
// Observable via: aria-expanded on the search trigger button, and the presence
// of data-testid="global-search-modal-mock" in the DOM.

describe("InventoryNavbar — search open state (button + cmd-K share state)", () => {
  it("cmd-K (metaKey+k) opens the modal — aria-expanded becomes 'true'", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("global-search-modal-mock")).toBeTruthy();
  });

  it("Ctrl+K (ctrlKey+k) opens the modal — aria-expanded becomes 'true'", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("global-search-modal-mock")).toBeTruthy();
  });

  it("cmd-K calls preventDefault to suppress browser default behaviour", () => {
    renderNavbar();

    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalledOnce();
  });

  it("Ctrl+K also calls preventDefault", () => {
    renderNavbar();

    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalledOnce();
  });

  it("second cmd-K toggles modal closed — aria-expanded returns to 'false'", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    // Open
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    // Close
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("global-search-modal-mock")).toBeNull();
  });

  it("first Ctrl+K opens, second Ctrl+K closes", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("button click then cmd-K closes the modal (shared state via ref)", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    // Open via button (openSearchModal → ref=true, state=true)
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    // cmd-K reads ref (true) → toggles to false → closes modal
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("global-search-modal-mock")).toBeNull();
  });

  it("cmd-K opens, clicking the button again keeps modal open (openSearchModal only opens)", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    // Open via cmd-K (ref=true, state=true)
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    // Clicking the button calls openSearchModal → state already true, no-op
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("global-search-modal-mock")).toBeTruthy();
  });

  it("unrelated keydown (Ctrl+F) does not open the modal", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    fireEvent.keyDown(document, { key: "f", ctrlKey: true });

    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("global-search-modal-mock")).toBeNull();
  });

  it("pressing 'k' without a modifier does not open the modal", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    fireEvent.keyDown(document, { key: "k" });

    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("global-search-modal-mock")).toBeNull();
  });

  it("cmd-K toggle is idempotent across multiple open/close cycles", () => {
    renderNavbar();
    const btn = screen.getByRole("button", { name: /^search cases$/i });

    // Cycle 1 — metaKey
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("false");

    // Cycle 2 — ctrlKey
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});

// ─── Mobile menu toggle button ────────────────────────────────────────────────

describe("InventoryNavbar — mobile menu toggle button", () => {
  it("does NOT render a toggle button when onMenuToggle is absent", () => {
    renderNavbar();
    // No onMenuToggle prop → toggle should not be present
    const toggle = screen.queryByRole("button", { name: /navigation menu/i });
    // The only button in the navbar without onMenuToggle is the avatar trigger
    // The toggle label matches /navigation menu/ — verify it is null
    expect(toggle).toBeNull();
  });

  it("renders a toggle button when onMenuToggle is provided", () => {
    const onMenuToggle = vi.fn();
    renderNavbar({ onMenuToggle });
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    expect(toggle).toBeTruthy();
  });

  it("toggle button has aria-expanded='false' when mobileNavOpen is false", () => {
    const onMenuToggle = vi.fn();
    renderNavbar({ onMenuToggle, mobileNavOpen: false });
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggle button has aria-expanded='true' when mobileNavOpen is true", () => {
    const onMenuToggle = vi.fn();
    renderNavbar({ onMenuToggle, mobileNavOpen: true });
    const toggle = screen.getByRole("button", { name: /close navigation menu/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggle button label is 'Open navigation menu' when nav is closed", () => {
    const onMenuToggle = vi.fn();
    renderNavbar({ onMenuToggle, mobileNavOpen: false });
    expect(screen.getByRole("button", { name: /open navigation menu/i })).toBeTruthy();
  });

  it("toggle button label is 'Close navigation menu' when nav is open", () => {
    const onMenuToggle = vi.fn();
    renderNavbar({ onMenuToggle, mobileNavOpen: true });
    expect(screen.getByRole("button", { name: /close navigation menu/i })).toBeTruthy();
  });

  it("calls onMenuToggle when the toggle button is clicked", () => {
    const onMenuToggle = vi.fn();
    renderNavbar({ onMenuToggle, mobileNavOpen: false });
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    fireEvent.click(toggle);
    expect(onMenuToggle).toHaveBeenCalledOnce();
  });

  it("toggle button has aria-controls='inventory-side-nav'", () => {
    const onMenuToggle = vi.fn();
    renderNavbar({ onMenuToggle });
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    expect(toggle.getAttribute("aria-controls")).toBe("inventory-side-nav");
  });

  it("toggle button has type='button' to prevent form submission", () => {
    const onMenuToggle = vi.fn();
    renderNavbar({ onMenuToggle });
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    expect(toggle.getAttribute("type")).toBe("button");
  });
});
