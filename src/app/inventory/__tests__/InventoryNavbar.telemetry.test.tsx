/**
 * @vitest-environment jsdom
 *
 * Unit tests: InventoryNavbar — search submit telemetry.
 *
 * Verifies that INV_ACTION_SEARCH_SUBMITTED is fired via `trackEvent` whenever
 * the user submits a non-empty global case search through the GlobalSearchModal.
 *
 * Architecture note
 * ─────────────────
 * The search is no longer an inline form.  Clicking (or pressing ⌘K / Ctrl+K)
 * opens a GlobalSearchModal overlay that contains the real <form role="search">
 * and <input type="search"> elements.  The modal is rendered via
 * ReactDOM.createPortal into document.body, so RTL's `screen` queries find it.
 *
 * The GlobalSearchModal intentionally does NOT call onSubmit for empty or
 * whitespace-only queries (guarded in its handleSubmit).  Tests 5–6 below
 * verify that behaviour: no telemetry fires for blank submissions.
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at the module level so we can assert on exactly
 *   which events were emitted without touching any transport.
 * • Kinde auth hooks, connection state, and notification hooks are stubbed.
 * • Each test opens the modal by clicking the "Search cases" trigger button,
 *   then interacts with the real DOM input inside the modal overlay.
 * • act() wrappers flush the isMounted + isVisible effects in GlobalSearchModal.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Submitting a non-empty search fires INV_ACTION_SEARCH_SUBMITTED.
 * 2. Submitted event has eventCategory="user_action", eventName, app="inventory".
 * 3. queryLength matches the length of the trimmed search query.
 * 4. queryLength trims leading/trailing whitespace before counting.
 * 5. submitMethod is "form_submit".
 * 6. Submitting whitespace-only does NOT fire the event (GlobalSearchModal guard).
 * 7. Submitting an empty input does NOT fire the event.
 * 8. Multiple non-empty submits each fire a separate trackEvent call.
 * 9. Each successive submit records the current input value's trimmed length.
 */

import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
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

// ─── Mock Kinde auth (browser client) ────────────────────────────────────────

vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: () => ({
    user: {
      given_name: "Jane",
      family_name: "Smith",
      email: "jane.smith@skyspecs.com",
    },
  }),
}));

vi.mock("@kinde-oss/kinde-auth-nextjs/components", () => ({
  LogoutLink: ({ children }: { children: React.ReactNode }) => (
    <a href="/api/auth/logout" data-testid="logout-link">
      {children}
    </a>
  ),
}));

// ─── Mock Convex hooks (ConnectionIndicator + NotificationBell deps) ──────────

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

vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({
    unreadCount: 0,
    notifications: [],
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
  }),
}));

// ─── Module under test (after all mocks are registered) ──────────────────────

import { InventoryNavbar } from "../InventoryNavbar";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderNavbar() {
  return render(<InventoryNavbar />);
}

/**
 * Click the "Search cases" trigger button in the navbar to open the
 * GlobalSearchModal overlay.  Wraps in act() so the isMounted and isVisible
 * effects inside GlobalSearchModal flush before we proceed.
 */
async function openModal() {
  const searchButton = screen.getByRole("button", { name: /search cases/i });
  await act(async () => {
    fireEvent.click(searchButton);
  });
}

/**
 * Return the search input element inside the open GlobalSearchModal.
 * The input has data-testid="global-search-input" for stable selection.
 */
function getSearchInput() {
  return screen.getByTestId("global-search-input") as HTMLInputElement;
}

/**
 * Return the search <form role="search"> element inside the open modal.
 */
function getSearchForm() {
  return screen.getByRole("search", { name: /search cases/i }) as HTMLFormElement;
}

/**
 * Open the modal (if not already open), type a value into the search input,
 * and submit the form.  The modal stays open after submission so this can be
 * called multiple times in a single test to simulate sequential submissions.
 */
async function typeAndSubmit(value: string) {
  // Open the modal only if it isn't already visible
  if (!screen.queryByTestId("global-search-input")) {
    await openModal();
  }
  const input = getSearchInput();
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  const form = getSearchForm();
  await act(async () => {
    fireEvent.submit(form);
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  mockTrackEvent.mockClear();
  vi.clearAllTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InventoryNavbar — search submit telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  // ─── 1. Non-empty search fires the event ─────────────────────────────────

  it("fires INV_ACTION_SEARCH_SUBMITTED when the search form is submitted with a query", async () => {
    renderNavbar();
    await typeAndSubmit("drone kit");

    const searchEvents = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .filter((e) => e.eventName === TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);

    expect(searchEvents).toHaveLength(1);
  });

  // ─── 2. Event has required fields ────────────────────────────────────────

  it("emitted event has eventCategory='user_action', app='inventory'", async () => {
    renderNavbar();
    await typeAndSubmit("case_xyz");

    const event = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .find((e) => e.eventName === TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);

    expect(event).toBeDefined();
    expect(event!.eventCategory).toBe("user_action");
    expect(event!.eventName).toBe(TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);
    expect(event!.app).toBe("inventory");
  });

  // ─── 3. queryLength reflects the trimmed query length ─────────────────────

  it("queryLength equals the character count of the trimmed search query", async () => {
    renderNavbar();
    await typeAndSubmit("drone kit");

    const event = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .find((e) => e.eventName === TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);

    // "drone kit".trim().length === 9
    expect(event!.queryLength).toBe(9);
  });

  it("queryLength trims leading/trailing whitespace before counting", async () => {
    renderNavbar();
    // "  abc  " trimmed = "abc" (length 3); GlobalSearchModal trims before submit
    await typeAndSubmit("  abc  ");

    const event = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .find((e) => e.eventName === TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);

    expect(event!.queryLength).toBe(3);
  });

  // ─── 4. submitMethod is "form_submit" ─────────────────────────────────────

  it("submitMethod is 'form_submit' when the form submit event fires", async () => {
    renderNavbar();
    await typeAndSubmit("inspection");

    const event = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .find((e) => e.eventName === TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);

    expect(event!.submitMethod).toBe("form_submit");
  });

  // ─── 5–6. Empty / whitespace does NOT fire (GlobalSearchModal guard) ──────
  //
  // GlobalSearchModal.handleSubmit guards `if (trimmed)` before calling onSubmit.
  // Submitting blank or whitespace-only does not propagate to InventoryNavbar's
  // handleSearchSubmit, so no telemetry event should fire.

  it("does NOT fire INV_ACTION_SEARCH_SUBMITTED when only whitespace is submitted", async () => {
    renderNavbar();
    await openModal();
    const input = getSearchInput();
    await act(async () => {
      fireEvent.change(input, { target: { value: "   " } });
    });
    const form = getSearchForm();
    await act(async () => {
      fireEvent.submit(form);
    });

    const searchEvents = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .filter((e) => e.eventName === TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);

    expect(searchEvents).toHaveLength(0);
  });

  it("does NOT fire INV_ACTION_SEARCH_SUBMITTED when the input is empty", async () => {
    renderNavbar();
    await openModal();
    // Do not type anything — submit the empty form
    const form = getSearchForm();
    await act(async () => {
      fireEvent.submit(form);
    });

    const searchEvents = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .filter((e) => e.eventName === TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);

    expect(searchEvents).toHaveLength(0);
  });

  // ─── 7. Multiple submits each fire a separate event ───────────────────────

  it("fires one INV_ACTION_SEARCH_SUBMITTED per submission (multiple submits = multiple events)", async () => {
    renderNavbar();

    // First submit
    await typeAndSubmit("query one");
    // Second submit (modal stays open; typeAndSubmit detects it's still open)
    await typeAndSubmit("query two");
    // Third submit without changing the input (modal open, query still "query two")
    const form = getSearchForm();
    await act(async () => {
      fireEvent.submit(form);
    });

    const searchEvents = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .filter((e) => e.eventName === TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);

    expect(searchEvents).toHaveLength(3);
  });

  // ─── 8. Correct queryLength for each successive submit ────────────────────

  it("each successive submit records the current input value's length", async () => {
    renderNavbar();
    await openModal();
    const input = getSearchInput();
    const form = getSearchForm();

    await act(async () => {
      fireEvent.change(input, { target: { value: "ab" } });
    });
    await act(async () => {
      fireEvent.submit(form);
    });

    await act(async () => {
      fireEvent.change(input, { target: { value: "abcde" } });
    });
    await act(async () => {
      fireEvent.submit(form);
    });

    const searchEvents = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .filter((e) => e.eventName === TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED);

    expect(searchEvents).toHaveLength(2);
    expect(searchEvents[0].queryLength).toBe(2);
    expect(searchEvents[1].queryLength).toBe(5);
  });
});
