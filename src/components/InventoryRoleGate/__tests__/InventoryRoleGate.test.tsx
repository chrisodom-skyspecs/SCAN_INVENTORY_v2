/**
 * @vitest-environment jsdom
 *
 * Unit tests for InventoryRoleGate component.
 *
 * Tests cover:
 *   1. Loading state — renders the default loading skeleton.
 *   2. Custom loading element is rendered during loading.
 *   3. Admin access (require="operator") — renders children.
 *   4. Operator access (require="operator") — renders children.
 *   5. Technician denied (require="operator") — children not rendered, redirect fires.
 *   6. Pilot denied (require="operator") — children not rendered, redirect fires.
 *   7. No role denied (require="operator") — children not rendered, redirect fires.
 *   8. Admin access (require="admin") — renders children.
 *   9. Operator denied (require="admin") — children not rendered, redirect fires.
 *  10. Technician denied (require="admin") — children not rendered, redirect fires.
 *  11. Redirect target defaults to "/inventory".
 *  12. Custom fallbackUrl is used when provided.
 *  13. Unauthenticated user is redirected regardless of require prop.
 *  14. Loading state does not redirect (useEffect is skipped while loading).
 *
 * Run: npx vitest run src/components/InventoryRoleGate/__tests__/InventoryRoleGate.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../hooks/use-current-user", () => ({
  useCurrentUser: vi.fn(),
}));

const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
}));

import { useCurrentUser } from "../../../hooks/use-current-user";
import { InventoryRoleGate } from "../InventoryRoleGate";

const mockUseCurrentUser = useCurrentUser as ReturnType<typeof vi.fn>;

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

type MockRole = "admin" | "operator" | "technician" | "pilot" | null;

/**
 * Set the mocked useCurrentUser return value for a given role.
 */
function setRole(
  primaryRole: MockRole,
  overrides: Partial<ReturnType<typeof useCurrentUser>> = {},
) {
  const roles = primaryRole ? [primaryRole] : [];
  mockUseCurrentUser.mockReturnValue({
    id: "kinde_test_user",
    name: "Test User",
    roles,
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
    name: "Operator",
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

function setUnauthenticated() {
  mockUseCurrentUser.mockReturnValue({
    id: "",
    name: "Operator",
    roles: [],
    primaryRole: null,
    isAdmin: false,
    isTechnician: false,
    isPilot: false,
    isLoading: false,
    isAuthenticated: false,
    can: vi.fn(() => false),
  });
}

// ─── 1. Loading state ─────────────────────────────────────────────────────────

describe("InventoryRoleGate — loading state", () => {
  beforeEach(() => setLoading());

  it("renders the default loading skeleton when isLoading is true", () => {
    render(
      <InventoryRoleGate require="operator">
        <div data-testid="protected">Admin content</div>
      </InventoryRoleGate>,
    );

    expect(screen.getByTestId("inv-role-gate-loading")).toBeTruthy();
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("does NOT redirect while isLoading is true", () => {
    render(
      <InventoryRoleGate require="operator">
        <div>Protected</div>
      </InventoryRoleGate>,
    );

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

// ─── 2. Custom loading element ────────────────────────────────────────────────

describe("InventoryRoleGate — custom loading", () => {
  beforeEach(() => setLoading());

  it("renders the custom loading element when provided", () => {
    render(
      <InventoryRoleGate
        require="operator"
        loading={<div data-testid="custom-loading">Checking permissions…</div>}
      >
        <div data-testid="protected">Admin content</div>
      </InventoryRoleGate>,
    );

    expect(screen.getByTestId("custom-loading")).toBeTruthy();
    expect(screen.queryByTestId("protected")).toBeNull();
  });
});

// ─── 3. Admin access (require="operator") ────────────────────────────────────

describe("InventoryRoleGate — admin passes operator gate", () => {
  beforeEach(() => setRole("admin"));

  it("renders children when user is admin and require='operator'", () => {
    render(
      <InventoryRoleGate require="operator">
        <div data-testid="protected">Template management</div>
      </InventoryRoleGate>,
    );

    expect(screen.getByTestId("protected")).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

// ─── 4. Operator access (require="operator") ─────────────────────────────────

describe("InventoryRoleGate — operator passes operator gate", () => {
  beforeEach(() => setRole("operator"));

  it("renders children when user is operator and require='operator'", () => {
    render(
      <InventoryRoleGate require="operator">
        <div data-testid="protected">Template management</div>
      </InventoryRoleGate>,
    );

    expect(screen.getByTestId("protected")).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

// ─── 5. Technician denied (require="operator") ───────────────────────────────

describe("InventoryRoleGate — technician denied at operator gate", () => {
  beforeEach(() => setRole("technician"));

  it("does NOT render children when user is technician and require='operator'", () => {
    render(
      <InventoryRoleGate require="operator">
        <div data-testid="protected">Admin content</div>
      </InventoryRoleGate>,
    );

    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("fires router.replace to fallbackUrl when denied", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="operator">
          <div>Admin content</div>
        </InventoryRoleGate>,
      );
    });

    expect(mockRouterReplace).toHaveBeenCalledWith("/inventory");
  });
});

// ─── 6. Pilot denied (require="operator") ────────────────────────────────────

describe("InventoryRoleGate — pilot denied at operator gate", () => {
  beforeEach(() => setRole("pilot"));

  it("does NOT render children when user is pilot and require='operator'", () => {
    render(
      <InventoryRoleGate require="operator">
        <div data-testid="protected">Admin content</div>
      </InventoryRoleGate>,
    );

    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("fires router.replace when pilot is denied", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="operator">
          <div>Admin content</div>
        </InventoryRoleGate>,
      );
    });

    expect(mockRouterReplace).toHaveBeenCalledWith("/inventory");
  });
});

// ─── 7. No role denied (require="operator") ──────────────────────────────────

describe("InventoryRoleGate — no role denied at operator gate", () => {
  beforeEach(() => setRole(null));

  it("does NOT render children when user has no role", () => {
    render(
      <InventoryRoleGate require="operator">
        <div data-testid="protected">Admin content</div>
      </InventoryRoleGate>,
    );

    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("fires router.replace when no role is present", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="operator">
          <div>Admin content</div>
        </InventoryRoleGate>,
      );
    });

    expect(mockRouterReplace).toHaveBeenCalledWith("/inventory");
  });
});

// ─── 8. Admin access (require="admin") ───────────────────────────────────────

describe("InventoryRoleGate — admin passes admin gate", () => {
  beforeEach(() => setRole("admin"));

  it("renders children when user is admin and require='admin'", () => {
    render(
      <InventoryRoleGate require="admin">
        <div data-testid="admin-protected">User management</div>
      </InventoryRoleGate>,
    );

    expect(screen.getByTestId("admin-protected")).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

// ─── 9. Operator denied (require="admin") ────────────────────────────────────

describe("InventoryRoleGate — operator denied at admin gate", () => {
  beforeEach(() => setRole("operator"));

  it("does NOT render children when user is operator and require='admin'", () => {
    render(
      <InventoryRoleGate require="admin">
        <div data-testid="admin-protected">User management</div>
      </InventoryRoleGate>,
    );

    expect(screen.queryByTestId("admin-protected")).toBeNull();
  });

  it("fires router.replace when operator is denied at admin gate", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="admin">
          <div>User management</div>
        </InventoryRoleGate>,
      );
    });

    expect(mockRouterReplace).toHaveBeenCalledWith("/inventory");
  });
});

// ─── 10. Technician denied (require="admin") ─────────────────────────────────

describe("InventoryRoleGate — technician denied at admin gate", () => {
  beforeEach(() => setRole("technician"));

  it("does NOT render children when user is technician and require='admin'", () => {
    render(
      <InventoryRoleGate require="admin">
        <div data-testid="admin-protected">User management</div>
      </InventoryRoleGate>,
    );

    expect(screen.queryByTestId("admin-protected")).toBeNull();
  });

  it("fires router.replace when technician is denied at admin gate", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="admin">
          <div>User management</div>
        </InventoryRoleGate>,
      );
    });

    expect(mockRouterReplace).toHaveBeenCalledWith("/inventory");
  });
});

// ─── 11. Default fallbackUrl is "/inventory" ─────────────────────────────────

describe("InventoryRoleGate — default fallback URL", () => {
  beforeEach(() => setRole("technician"));

  it("redirects to '/inventory' by default when access is denied", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="operator">
          <div>Admin content</div>
        </InventoryRoleGate>,
      );
    });

    expect(mockRouterReplace).toHaveBeenCalledWith("/inventory");
    expect(mockRouterReplace).not.toHaveBeenCalledWith(
      expect.not.stringContaining("/inventory"),
    );
  });
});

// ─── 12. Custom fallbackUrl ───────────────────────────────────────────────────

describe("InventoryRoleGate — custom fallback URL", () => {
  beforeEach(() => setRole("technician"));

  it("redirects to the custom fallbackUrl when provided and access is denied", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="operator" fallbackUrl="/inventory/cases">
          <div>Admin content</div>
        </InventoryRoleGate>,
      );
    });

    expect(mockRouterReplace).toHaveBeenCalledWith("/inventory/cases");
  });

  it("does NOT redirect to '/inventory' when a custom fallbackUrl is set", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="operator" fallbackUrl="/inventory/cases">
          <div>Admin content</div>
        </InventoryRoleGate>,
      );
    });

    expect(mockRouterReplace).not.toHaveBeenCalledWith("/inventory");
  });
});

// ─── 13. Unauthenticated user ─────────────────────────────────────────────────

describe("InventoryRoleGate — unauthenticated user", () => {
  beforeEach(() => setUnauthenticated());

  it("does NOT render children when user is unauthenticated", () => {
    render(
      <InventoryRoleGate require="operator">
        <div data-testid="protected">Admin content</div>
      </InventoryRoleGate>,
    );

    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("fires router.replace for unauthenticated users", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="operator">
          <div>Admin content</div>
        </InventoryRoleGate>,
      );
    });

    expect(mockRouterReplace).toHaveBeenCalledWith("/inventory");
  });
});

// ─── 14. Loading state does not redirect ─────────────────────────────────────

describe("InventoryRoleGate — loading state suppresses redirect", () => {
  beforeEach(() => setLoading());

  it("does NOT call router.replace while isLoading is true", async () => {
    await act(async () => {
      render(
        <InventoryRoleGate require="operator">
          <div>Admin content</div>
        </InventoryRoleGate>,
      );
    });

    // The useEffect has a `if (isLoading) return` guard; router should not fire.
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

// ─── 15. Multi-role user ──────────────────────────────────────────────────────

describe("InventoryRoleGate — multi-role user", () => {
  it("grants access when user holds both admin and operator roles", () => {
    mockUseCurrentUser.mockReturnValue({
      id: "kinde_multi_role",
      name: "Super User",
      roles: ["admin", "operator"],
      primaryRole: "admin",
      isAdmin: true,
      isTechnician: true,
      isPilot: false,
      isLoading: false,
      isAuthenticated: true,
      can: vi.fn(() => true),
    });

    render(
      <InventoryRoleGate require="operator">
        <div data-testid="protected">Admin content</div>
      </InventoryRoleGate>,
    );

    expect(screen.getByTestId("protected")).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("grants admin access when user holds both technician and admin roles", () => {
    mockUseCurrentUser.mockReturnValue({
      id: "kinde_multi_role",
      name: "Tech Admin",
      roles: ["technician", "admin"],
      primaryRole: "admin",
      isAdmin: true,
      isTechnician: true,
      isPilot: false,
      isLoading: false,
      isAuthenticated: true,
      can: vi.fn(() => true),
    });

    render(
      <InventoryRoleGate require="admin">
        <div data-testid="admin-protected">User management</div>
      </InventoryRoleGate>,
    );

    expect(screen.getByTestId("admin-protected")).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});
