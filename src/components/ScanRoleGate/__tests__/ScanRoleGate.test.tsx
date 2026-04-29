/**
 * @vitest-environment jsdom
 *
 * Unit tests for ScanRoleGate component.
 *
 * Tests cover:
 *   1. Loading state — renders the default loading skeleton.
 *   2. Technician access — renders children when the user is a technician.
 *   3. Admin access — renders children when require="technician" and user is admin.
 *   4. Pilot denied — renders the access-denied view when the user is a pilot
 *      and require="technician".
 *   5. No role denied — renders the access-denied view when the user has no role.
 *   6. Admin-only gate — renders children for admin only; denies technician.
 *   7. Access-denied view shows the required role name.
 *   8. Access-denied view includes a "Back to Case" link when caseId is provided.
 *   9. Access-denied view includes a "Back to SCAN" link when caseId is absent.
 *  10. Custom loading element is rendered during loading.
 *
 * Run with: npx vitest run src/components/ScanRoleGate/__tests__/ScanRoleGate.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../hooks/use-current-user", () => ({
  useCurrentUser: vi.fn(),
}));

// Mock next/link so it renders as an anchor tag in jsdom
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
import { ScanRoleGate } from "../ScanRoleGate";

const mockUseCurrentUser = useCurrentUser as ReturnType<typeof vi.fn>;

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

type PrimaryRole = "admin" | "technician" | "pilot" | null;

function setRole(
  primaryRole: PrimaryRole,
  overrides: Partial<ReturnType<typeof useCurrentUser>> = {}
) {
  mockUseCurrentUser.mockReturnValue({
    id: "kinde_test",
    name: "Test User",
    roles: primaryRole ? [primaryRole] : [],
    primaryRole,
    isAdmin: primaryRole === "admin",
    isTechnician: primaryRole === "technician" || primaryRole === "admin",
    isPilot: primaryRole === "pilot",
    isLoading: false,
    isAuthenticated: true,
    can: vi.fn(() => false),
    ...overrides,
  });
}

function setLoading() {
  mockUseCurrentUser.mockReturnValue({
    id: "",
    name: "Field Technician",
    roles: [],
    primaryRole: null,
    isAdmin: false,
    isTechnician: false,
    isPilot: false,
    isLoading: true,
    isAuthenticated: false,
    can: vi.fn(() => false),
  });
}

// ─── 1. Loading state ─────────────────────────────────────────────────────────

describe("ScanRoleGate — loading state", () => {
  beforeEach(() => setLoading());

  it("renders the default loading skeleton when isLoading is true", () => {
    render(
      <ScanRoleGate require="technician">
        <div data-testid="protected">Protected content</div>
      </ScanRoleGate>
    );

    // Loading skeleton should be present (aria-label="Verifying access")
    expect(screen.getByRole("status")).toBeTruthy();
    // Protected content should NOT be rendered
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("renders a custom loading element when provided", () => {
    render(
      <ScanRoleGate
        require="technician"
        loading={<div data-testid="custom-loading">Loading roles…</div>}
      >
        <div data-testid="protected">Protected content</div>
      </ScanRoleGate>
    );

    expect(screen.getByTestId("custom-loading")).toBeTruthy();
    expect(screen.queryByTestId("protected")).toBeNull();
  });
});

// ─── 2. Technician access ─────────────────────────────────────────────────────

describe("ScanRoleGate — technician access", () => {
  beforeEach(() => setRole("technician"));

  it("renders children when user is a technician and require='technician'", () => {
    render(
      <ScanRoleGate require="technician">
        <div data-testid="protected">Inspect page</div>
      </ScanRoleGate>
    );

    expect(screen.getByTestId("protected")).toBeTruthy();
    expect(screen.queryByTestId("scan-role-gate-denied")).toBeNull();
  });
});

// ─── 3. Admin access (superset of technician) ────────────────────────────────

describe("ScanRoleGate — admin access as technician", () => {
  beforeEach(() => setRole("admin"));

  it("renders children when user is admin and require='technician'", () => {
    render(
      <ScanRoleGate require="technician">
        <div data-testid="admin-protected">Inspect page</div>
      </ScanRoleGate>
    );

    expect(screen.getByTestId("admin-protected")).toBeTruthy();
    expect(screen.queryByTestId("scan-role-gate-denied")).toBeNull();
  });
});

// ─── 4. Pilot denied for technician-required content ─────────────────────────

describe("ScanRoleGate — pilot denied", () => {
  beforeEach(() => setRole("pilot"));

  it("renders access-denied view for pilot when require='technician'", () => {
    render(
      <ScanRoleGate require="technician">
        <div data-testid="protected">Inspect page</div>
      </ScanRoleGate>
    );

    expect(screen.getByTestId("scan-role-gate-denied")).toBeTruthy();
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("access-denied view mentions 'Technician or Admin'", () => {
    render(
      <ScanRoleGate require="technician">
        <div>Protected</div>
      </ScanRoleGate>
    );

    expect(screen.getByText(/technician or admin/i)).toBeTruthy();
  });

  it("shows 'Access Restricted' heading in denied view", () => {
    render(
      <ScanRoleGate require="technician">
        <div>Protected</div>
      </ScanRoleGate>
    );

    expect(screen.getByRole("heading", { name: /access restricted/i })).toBeTruthy();
  });
});

// ─── 5. No role denied ───────────────────────────────────────────────────────

describe("ScanRoleGate — no role denied", () => {
  beforeEach(() => setRole(null));

  it("renders access-denied view when user has no role", () => {
    render(
      <ScanRoleGate require="technician">
        <div data-testid="protected">Inspect page</div>
      </ScanRoleGate>
    );

    expect(screen.getByTestId("scan-role-gate-denied")).toBeTruthy();
    expect(screen.queryByTestId("protected")).toBeNull();
  });
});

// ─── 6. Admin-only gate ───────────────────────────────────────────────────────

describe("ScanRoleGate — admin-only gate", () => {
  it("renders children when user is admin and require='admin'", () => {
    setRole("admin");

    render(
      <ScanRoleGate require="admin">
        <div data-testid="admin-content">Admin panel</div>
      </ScanRoleGate>
    );

    expect(screen.getByTestId("admin-content")).toBeTruthy();
  });

  it("renders denied view when user is technician and require='admin'", () => {
    setRole("technician");

    render(
      <ScanRoleGate require="admin">
        <div data-testid="admin-content">Admin panel</div>
      </ScanRoleGate>
    );

    expect(screen.getByTestId("scan-role-gate-denied")).toBeTruthy();
    expect(screen.queryByTestId("admin-content")).toBeNull();
  });

  it("renders denied view when user is pilot and require='admin'", () => {
    setRole("pilot");

    render(
      <ScanRoleGate require="admin">
        <div data-testid="admin-content">Admin panel</div>
      </ScanRoleGate>
    );

    expect(screen.getByTestId("scan-role-gate-denied")).toBeTruthy();
    expect(screen.queryByTestId("admin-content")).toBeNull();
  });
});

// ─── 7. Access-denied shows required role text ─────────────────────────────────

describe("ScanRoleGate — denied view required role text", () => {
  it("includes 'Admin' when require='admin' and user is pilot", () => {
    setRole("pilot");

    render(
      <ScanRoleGate require="admin">
        <div>Protected</div>
      </ScanRoleGate>
    );

    // "Admin" appears in the "requires" text
    const adminMatches = screen.getAllByText(/admin/i);
    expect(adminMatches.length).toBeGreaterThan(0);
  });
});

// ─── 8. Back to Case link when caseId provided ───────────────────────────────

describe("ScanRoleGate — back navigation with caseId", () => {
  beforeEach(() => setRole("pilot"));

  it("shows 'Back to Case' link with correct href when caseId is provided", () => {
    render(
      <ScanRoleGate require="technician" caseId="case_abc123">
        <div>Protected</div>
      </ScanRoleGate>
    );

    const backLink = screen.getByTestId("scan-role-gate-back") as HTMLAnchorElement;
    expect(backLink).toBeTruthy();
    expect(backLink.getAttribute("href")).toBe("/scan/case_abc123");
    expect(backLink.textContent).toMatch(/back to case/i);
  });
});

// ─── 9. Back to SCAN link when caseId absent ─────────────────────────────────

describe("ScanRoleGate — back navigation without caseId", () => {
  beforeEach(() => setRole("pilot"));

  it("shows 'Back to SCAN' link when no caseId is provided", () => {
    render(
      <ScanRoleGate require="technician">
        <div>Protected</div>
      </ScanRoleGate>
    );

    const backLink = screen.getByTestId("scan-role-gate-back") as HTMLAnchorElement;
    expect(backLink).toBeTruthy();
    expect(backLink.getAttribute("href")).toBe("/scan");
    expect(backLink.textContent).toMatch(/back to scan/i);
  });
});

// ─── 10. Denied view role tag ──────────────────────────────────────────────────

describe("ScanRoleGate — denied view data-testid", () => {
  it("denied view has data-testid='scan-role-gate-denied'", () => {
    setRole("pilot");

    render(
      <ScanRoleGate require="technician">
        <div>Protected</div>
      </ScanRoleGate>
    );

    const deniedEl = screen.getByTestId("scan-role-gate-denied");
    expect(deniedEl).toBeTruthy();
    expect(deniedEl.getAttribute("role")).toBe("alert");
  });
});
