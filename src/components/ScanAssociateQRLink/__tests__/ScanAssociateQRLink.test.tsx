/**
 * @vitest-environment jsdom
 *
 * Unit tests for ScanAssociateQRLink component (Sub-AC 3 entry point).
 *
 * Tests cover:
 *   1. Renders link for admin users
 *   2. Renders link for technician users
 *   3. Hides link for pilots
 *   4. Hides link while session is loading (prevents flash for pilots)
 *   5. Hides link when user has no role assigned
 *   6. CTA href points to /scan/associate
 *   7. forceShow override displays the link regardless of role
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../ScanAssociateQRLink.module.css", () => ({ default: {} }));

vi.mock("../../../hooks/use-current-user", () => ({
  useCurrentUser: vi.fn(),
}));

// next/link → render as plain <a> in jsdom
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { useCurrentUser } from "../../../hooks/use-current-user";
import { ScanAssociateQRLink } from "../ScanAssociateQRLink";

const mockUseCurrentUser = useCurrentUser as ReturnType<typeof vi.fn>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setUser(opts: {
  isLoading?: boolean;
  isTechnician?: boolean;
  isAdmin?: boolean;
  primaryRole?: "admin" | "technician" | "pilot" | null;
}) {
  mockUseCurrentUser.mockReturnValue({
    id: "user_test",
    name: "Test User",
    isLoading: opts.isLoading ?? false,
    isAuthenticated: true,
    isTechnician: opts.isTechnician ?? false,
    isAdmin: opts.isAdmin ?? false,
    isPilot: !opts.isTechnician && !opts.isAdmin,
    primaryRole: opts.primaryRole ?? null,
    roles: opts.primaryRole ? [opts.primaryRole] : [],
    can: () => false,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScanAssociateQRLink — Sub-AC 3 entry point", () => {
  it("1. renders the link for admin users", () => {
    setUser({ isAdmin: true, isTechnician: true, primaryRole: "admin" });
    render(<ScanAssociateQRLink />);
    expect(screen.queryByTestId("scan-associate-qr-link")).not.toBeNull();
  });

  it("2. renders the link for technician users", () => {
    setUser({ isTechnician: true, primaryRole: "technician" });
    render(<ScanAssociateQRLink />);
    expect(screen.queryByTestId("scan-associate-qr-link")).not.toBeNull();
  });

  it("3. hides the link for pilots", () => {
    setUser({ isTechnician: false, isAdmin: false, primaryRole: "pilot" });
    render(<ScanAssociateQRLink />);
    expect(screen.queryByTestId("scan-associate-qr-link")).toBeNull();
  });

  it("4. hides the link while the session is loading", () => {
    setUser({ isLoading: true, isTechnician: true });
    render(<ScanAssociateQRLink />);
    expect(screen.queryByTestId("scan-associate-qr-link")).toBeNull();
  });

  it("5. hides the link when the user has no role assigned", () => {
    setUser({ primaryRole: null });
    render(<ScanAssociateQRLink />);
    expect(screen.queryByTestId("scan-associate-qr-link")).toBeNull();
  });

  it("6. CTA href points to /scan/associate", () => {
    setUser({ isTechnician: true, primaryRole: "technician" });
    render(<ScanAssociateQRLink />);
    const cta = screen.getByTestId(
      "scan-associate-qr-link-cta"
    ) as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe("/scan/associate");
  });

  it("7. forceShow override displays the link for any role", () => {
    setUser({ isTechnician: false, isAdmin: false, primaryRole: "pilot" });
    render(<ScanAssociateQRLink forceShow />);
    expect(screen.queryByTestId("scan-associate-qr-link")).not.toBeNull();
  });
});
