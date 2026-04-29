// @vitest-environment jsdom

/**
 * ScanLogoutButton.test.tsx
 *
 * Unit tests for the ScanLogoutButton component.
 *
 * Tests cover:
 *   1. Renders correctly in both "link" and "header" variants
 *   2. Has correct accessible label (aria-label)
 *   3. Button is type="submit" (inside a form)
 *   4. Custom label prop is applied
 *   5. Icon only renders in "header" variant
 *   6. The form has a server action attached
 *   7. Clicking the button calls scanLogout
 *
 * Mocking strategy:
 *   - @/app/scan/actions: the `scanLogout` server action is mocked to a spy
 *     that returns a resolved Promise (the real action calls `redirect()`
 *     which throws in a browser context).
 *
 * Note: ScanLogoutButton is a Client Component ("use client").  We test it
 * in a jsdom environment with React Testing Library.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ─── DOM cleanup ──────────────────────────────────────────────────────────────

afterEach(cleanup);

// ─── Mock: scan server action ─────────────────────────────────────────────────
// Use vi.mock with a factory that returns vi.fn() directly.
// scanLogoutMock is retrieved from the module after import.

vi.mock("@/app/scan/actions", () => ({
  scanLogout: vi.fn(() => Promise.resolve()),
}));

// ─── Import under test ────────────────────────────────────────────────────────

// Import AFTER vi.mock calls
import { ScanLogoutButton } from "../ScanLogoutButton";
import * as scanActions from "@/app/scan/actions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderLink(props: Partial<React.ComponentProps<typeof ScanLogoutButton>> = {}) {
  return render(<ScanLogoutButton variant="link" {...props} />);
}

function renderHeader(props: Partial<React.ComponentProps<typeof ScanLogoutButton>> = {}) {
  return render(<ScanLogoutButton variant="header" {...props} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScanLogoutButton — link variant", () => {
  beforeEach(() => {
    vi.mocked(scanActions.scanLogout).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.mocked(scanActions.scanLogout).mockClear();
  });

  it("renders a button element", () => {
    renderLink();
    const button = screen.getByRole("button");
    expect(button).toBeTruthy();
  });

  it("renders 'Sign out' visible text", () => {
    renderLink();
    expect(screen.getByText("Sign out")).toBeTruthy();
  });

  it("button is type submit (inside a form)", () => {
    renderLink();
    const button = screen.getByRole("button");
    expect(button.getAttribute("type")).toBe("submit");
  });

  it("has default accessible label", () => {
    renderLink();
    const button = screen.getByRole("button", {
      name: /sign out of skyspecs scan/i,
    });
    expect(button).toBeTruthy();
  });

  it("accepts a custom label prop", () => {
    renderLink({ label: "Log out of the field app" });
    const button = screen.getByRole("button", {
      name: /log out of the field app/i,
    });
    expect(button).toBeTruthy();
  });

  it("does NOT render an icon SVG in link variant", () => {
    renderLink();
    // The icon is only present in the header variant
    const svg = document.querySelector("svg");
    expect(svg).toBeNull();
  });

  it("is wrapped in a form element", () => {
    renderLink();
    const form = document.querySelector("form");
    expect(form).toBeTruthy();
  });

  it("is not disabled initially (not in pending state)", () => {
    renderLink();
    const button = screen.getByRole("button");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("is not aria-busy initially", () => {
    renderLink();
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-busy")).toBe("false");
  });
});

describe("ScanLogoutButton — header variant", () => {
  beforeEach(() => {
    vi.mocked(scanActions.scanLogout).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.mocked(scanActions.scanLogout).mockClear();
  });

  it("renders a button element", () => {
    renderHeader();
    const button = screen.getByRole("button");
    expect(button).toBeTruthy();
  });

  it("renders 'Sign out' visible text", () => {
    renderHeader();
    expect(screen.getByText("Sign out")).toBeTruthy();
  });

  it("renders an icon SVG in header variant", () => {
    renderHeader();
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    // Icon is decorative — aria-hidden
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("has correct aria-label on the button", () => {
    renderHeader({ label: "Sign out of SkySpecs SCAN" });
    const button = screen.getByRole("button", {
      name: /sign out of skyspecs scan/i,
    });
    expect(button).toBeTruthy();
  });

  it("button type is submit", () => {
    renderHeader();
    const button = screen.getByRole("button");
    expect(button.getAttribute("type")).toBe("submit");
  });
});

describe("ScanLogoutButton — interaction", () => {
  beforeEach(() => {
    vi.mocked(scanActions.scanLogout).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.mocked(scanActions.scanLogout).mockClear();
  });

  it("calls scanLogout when button is clicked", async () => {
    renderLink();
    const button = screen.getByRole("button");
    fireEvent.click(button);
    // Give the async transition a tick to kick off
    await new Promise((r) => setTimeout(r, 0));
    expect(scanActions.scanLogout).toHaveBeenCalledOnce();
  });

  it("clicking the button prevents default form submission", () => {
    renderLink();
    const button = screen.getByRole("button");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    // If preventDefault was called, defaultPrevented is true
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("ScanLogoutButton — default props", () => {
  beforeEach(() => {
    vi.mocked(scanActions.scanLogout).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.mocked(scanActions.scanLogout).mockClear();
  });

  it("defaults to 'link' variant when variant prop is omitted", () => {
    render(<ScanLogoutButton />);
    const button = screen.getByRole("button");
    // In link variant there's no SVG icon
    expect(button).toBeTruthy();
    const svg = document.querySelector("svg");
    expect(svg).toBeNull();
  });

  it("uses default label when label prop is omitted", () => {
    render(<ScanLogoutButton />);
    const button = screen.getByRole("button", {
      name: /sign out of skyspecs scan/i,
    });
    expect(button).toBeTruthy();
  });
});
