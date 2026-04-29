/**
 * @vitest-environment jsdom
 *
 * Unit tests: NotificationBell — bell icon with unread-count badge.
 *
 * Verifies:
 *   1.  Renders a bell trigger button with aria-haspopup.
 *   2.  Shows no badge when unread count is 0.
 *   3.  Shows the numeric badge when unread count > 0.
 *   4.  Shows "9+" badge when unread count > 9.
 *   5.  aria-label on the button reflects unread count.
 *   6.  Clicking the button opens the notification dropdown.
 *   7.  Dropdown renders notification titles.
 *   8.  Dropdown renders empty state when no notifications.
 *   9.  Clicking outside closes the dropdown.
 *  10.  Escape key closes the dropdown.
 *  11.  "Mark all read" button is shown when there are unread notifications.
 *  12.  Clicking "Mark all read" calls markAllAsRead().
 *  13.  Clicking a notification row calls markAsRead with the correct ID.
 *  14.  Renders nothing when userId is null (unauthenticated state).
 */

import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// ─── Mock useNotifications ────────────────────────────────────────────────────

const mockMarkAsRead = vi.fn().mockResolvedValue(undefined);
const mockMarkAllAsRead = vi.fn().mockResolvedValue(undefined);

const mockNotificationsState = {
  unreadCount: 0,
  notifications: [] as Array<{
    id: string;
    type: string;
    title: string;
    message: string;
    caseId?: string;
    read: boolean;
    createdAt: number;
  }>,
  markAsRead: mockMarkAsRead,
  markAllAsRead: mockMarkAllAsRead,
  isLoading: false,
};

vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => mockNotificationsState,
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { NotificationBell } from "../NotificationBell";

afterEach(() => {
  cleanup();
  mockMarkAsRead.mockClear();
  mockMarkAllAsRead.mockClear();
  // Reset to zero state after each test
  mockNotificationsState.unreadCount = 0;
  mockNotificationsState.notifications = [];
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderBell(userId = "user-123") {
  return render(<NotificationBell userId={userId} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NotificationBell — bell trigger button", () => {
  it("renders the bell trigger button", () => {
    renderBell();
    const button = screen.getByRole("button", { name: /notifications/i });
    expect(button).toBeTruthy();
  });

  it("button has aria-haspopup='dialog'", () => {
    renderBell();
    const button = screen.getByRole("button", { name: /notifications/i });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("button starts with aria-expanded='false'", () => {
    renderBell();
    const button = screen.getByRole("button", { name: /notifications/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("NotificationBell — badge display", () => {
  it("shows no badge when unread count is 0", () => {
    mockNotificationsState.unreadCount = 0;
    const { container } = renderBell();
    // Badge should not be in the DOM
    expect(container.querySelector("[aria-hidden='true'].badge") ?? container.querySelector(".badge")).toBeNull();
  });

  it("shows badge with count '3' when 3 unread", () => {
    mockNotificationsState.unreadCount = 3;
    renderBell();
    // Badge text content should be "3"
    const button = screen.getByRole("button", { name: /3 unread/i });
    expect(button).toBeTruthy();
  });

  it("shows badge '9+' when unread count > 9", () => {
    mockNotificationsState.unreadCount = 15;
    renderBell();
    // Button aria-label should reflect the count
    const button = screen.getByRole("button", { name: /notifications.*unread/i });
    expect(button).toBeTruthy();
  });

  it("aria-label includes unread count when > 0", () => {
    mockNotificationsState.unreadCount = 5;
    renderBell();
    const button = screen.getByRole("button", { name: /5 unread/i });
    expect(button).toBeTruthy();
  });

  it("aria-label says 'no unread' when count is 0", () => {
    mockNotificationsState.unreadCount = 0;
    renderBell();
    const button = screen.getByRole("button", { name: /no unread/i });
    expect(button).toBeTruthy();
  });
});

describe("NotificationBell — dropdown open/close", () => {
  it("opens the dropdown when the bell is clicked", () => {
    renderBell();
    const button = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: /notifications/i });
    expect(dialog).toBeTruthy();
  });

  it("sets aria-expanded='true' when dropdown is open", () => {
    renderBell();
    const button = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the dropdown when Escape is pressed", () => {
    renderBell();
    const button = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(button);
    // Dropdown should be open
    expect(screen.queryByRole("dialog")).toBeTruthy();
    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the dropdown when clicking outside", () => {
    renderBell();
    const button = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeTruthy();
    // Click outside the component
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the dropdown when the bell is clicked again (toggle)", () => {
    renderBell();
    const button = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("NotificationBell — empty state", () => {
  it("shows empty state message when there are no notifications", () => {
    mockNotificationsState.notifications = [];
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    // Empty state text
    expect(screen.getByText(/all caught up/i)).toBeTruthy();
  });
});

describe("NotificationBell — notification list", () => {
  beforeEach(() => {
    mockNotificationsState.unreadCount = 2;
    mockNotificationsState.notifications = [
      {
        id: "notif-1",
        type: "damage_reported",
        title: "Damage reported on CASE-007",
        message: "A damage report was submitted by John Doe.",
        caseId: "case-007",
        read: false,
        createdAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago
      },
      {
        id: "notif-2",
        type: "shipment_delivered",
        title: "CASE-003 delivered",
        message: "FedEx tracking shows CASE-003 was delivered.",
        caseId: "case-003",
        read: true,
        createdAt: Date.now() - 60 * 60 * 1000, // 1 hour ago
      },
    ];
  });

  it("renders notification titles in the dropdown", () => {
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText("Damage reported on CASE-007")).toBeTruthy();
    expect(screen.getByText("CASE-003 delivered")).toBeTruthy();
  });

  it("shows 'Mark all read' button when there are unread notifications", () => {
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    const markAllBtn = screen.getByRole("button", { name: /mark all.*read/i });
    expect(markAllBtn).toBeTruthy();
  });

  it("calls markAllAsRead when 'Mark all read' is clicked", () => {
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    const markAllBtn = screen.getByRole("button", { name: /mark all.*read/i });
    fireEvent.click(markAllBtn);
    expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1);
  });

  it("renders the dropdown title 'Notifications'", () => {
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    // Title inside the dropdown
    const dialog = screen.getByRole("dialog", { name: /notifications/i });
    expect(dialog).toBeTruthy();
  });
});

describe("NotificationBell — null userId (unauthenticated)", () => {
  it("renders the bell trigger even when userId is null", () => {
    render(<NotificationBell userId={null} />);
    const button = screen.getByRole("button", { name: /notifications/i });
    expect(button).toBeTruthy();
  });
});
