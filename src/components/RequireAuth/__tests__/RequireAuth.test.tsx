/**
 * @vitest-environment jsdom
 *
 * Unit tests: RequireAuth — client-side auth guard for INVENTORY routes.
 *
 * Tests the three behavioral states of RequireAuth:
 *
 *   1. Loading state (isLoading=true):
 *      • Renders the loading fallback ("Authenticating…")
 *      • Does NOT render children
 *      • Does NOT trigger a redirect
 *
 *   2. Unauthenticated state (isLoading=false, isAuthenticated=false):
 *      • Renders nothing (null)
 *      • Triggers router.replace() with the loginUrl
 *
 *   3. Authenticated state (isLoading=false, isAuthenticated=true):
 *      • Renders children
 *      • Does NOT trigger a redirect
 *
 *   4. Custom loginUrl override:
 *      • Redirects to the provided loginUrl when unauthenticated
 *
 *   5. Custom fallback override:
 *      • Renders the provided fallback instead of the default "Authenticating…"
 */

import React from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock router — capture router.replace() calls
const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
    push: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

// Mock Kinde — we control isLoading and isAuthenticated per test
let mockIsLoading = false;
let mockIsAuthenticated = false;

vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: () => ({
    isLoading: mockIsLoading,
    isAuthenticated: mockIsAuthenticated,
    user: mockIsAuthenticated
      ? { id: "user_abc", given_name: "Jane", email: "jane@skyspecs.com" }
      : null,
  }),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { RequireAuth } from "../RequireAuth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderGuard(props?: Partial<React.ComponentProps<typeof RequireAuth>>) {
  return render(
    <RequireAuth {...props}>
      <div data-testid="protected-content">Protected</div>
    </RequireAuth>
  );
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Reset mutable mock state to safe defaults
  mockIsLoading = false;
  mockIsAuthenticated = false;
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("RequireAuth — loading state (isLoading=true)", () => {
  beforeEach(() => {
    mockIsLoading = true;
    mockIsAuthenticated = false;
  });

  it("renders the default 'Authenticating…' fallback while loading", () => {
    renderGuard();
    expect(screen.getByText("Authenticating…")).toBeTruthy();
  });

  it("does NOT render children while loading", () => {
    renderGuard();
    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("does NOT trigger a redirect while loading", () => {
    renderGuard();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("renders a custom fallback when provided", () => {
    renderGuard({ fallback: <div data-testid="custom-fallback">Loading…</div> });
    expect(screen.getByTestId("custom-fallback")).toBeTruthy();
    expect(screen.queryByText("Authenticating…")).toBeNull();
  });

  it("loading fallback has role='status' for accessibility", () => {
    renderGuard();
    // The default AuthLoadingFallback has role="status"
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("loading fallback has aria-live='polite'", () => {
    renderGuard();
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });
});

// ─── Unauthenticated state ────────────────────────────────────────────────────

describe("RequireAuth — unauthenticated state (isLoading=false, isAuthenticated=false)", () => {
  beforeEach(() => {
    mockIsLoading = false;
    mockIsAuthenticated = false;
  });

  it("renders nothing (null) when unauthenticated", () => {
    const { container } = renderGuard();
    // Container should be empty — no protected content, no fallback
    expect(container.firstChild).toBeNull();
  });

  it("does NOT render children when unauthenticated", () => {
    renderGuard();
    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("does NOT render the loading fallback when auth has resolved", () => {
    renderGuard();
    expect(screen.queryByText("Authenticating…")).toBeNull();
  });

  it("calls router.replace() with the default loginUrl when unauthenticated", async () => {
    await act(async () => {
      renderGuard();
    });
    expect(mockRouterReplace).toHaveBeenCalledOnce();
    expect(mockRouterReplace).toHaveBeenCalledWith(
      "/scan/login?post_login_redirect_url=/inventory"
    );
  });

  it("calls router.replace() with a custom loginUrl when provided", async () => {
    const customLoginUrl =
      "/scan/login?post_login_redirect_url=/inventory/settings";
    await act(async () => {
      renderGuard({ loginUrl: customLoginUrl });
    });
    expect(mockRouterReplace).toHaveBeenCalledWith(customLoginUrl);
  });

  it("calls router.replace() only once (not on every render)", async () => {
    await act(async () => {
      renderGuard();
    });
    expect(mockRouterReplace).toHaveBeenCalledOnce();
  });
});

// ─── Authenticated state ──────────────────────────────────────────────────────

describe("RequireAuth — authenticated state (isLoading=false, isAuthenticated=true)", () => {
  beforeEach(() => {
    mockIsLoading = false;
    mockIsAuthenticated = true;
  });

  it("renders children when authenticated", () => {
    renderGuard();
    expect(screen.getByTestId("protected-content")).toBeTruthy();
    expect(screen.getByText("Protected")).toBeTruthy();
  });

  it("does NOT render the loading fallback when authenticated", () => {
    renderGuard();
    expect(screen.queryByText("Authenticating…")).toBeNull();
  });

  it("does NOT call router.replace() when authenticated", async () => {
    await act(async () => {
      renderGuard();
    });
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("renders multiple children when authenticated", () => {
    render(
      <RequireAuth>
        <div data-testid="child-a">A</div>
        <div data-testid="child-b">B</div>
      </RequireAuth>
    );
    expect(screen.getByTestId("child-a")).toBeTruthy();
    expect(screen.getByTestId("child-b")).toBeTruthy();
  });
});

// ─── Default loginUrl ─────────────────────────────────────────────────────────

describe("RequireAuth — default loginUrl", () => {
  beforeEach(() => {
    mockIsLoading = false;
    mockIsAuthenticated = false;
  });

  it("uses '/scan/login?post_login_redirect_url=/inventory' as the default loginUrl", async () => {
    await act(async () => {
      renderGuard(); // no loginUrl prop
    });
    expect(mockRouterReplace).toHaveBeenCalledWith(
      "/scan/login?post_login_redirect_url=/inventory"
    );
  });
});

// ─── Prop forwarding ──────────────────────────────────────────────────────────

describe("RequireAuth — prop types", () => {
  it("accepts children, loginUrl, and fallback props without TypeScript errors", () => {
    // This is a type-level test — if it compiles, the types are correct.
    // Runtime: just verify no errors are thrown during render.
    mockIsLoading = true;
    expect(() => {
      render(
        <RequireAuth
          loginUrl="/scan/login?post_login_redirect_url=/inventory/cases"
          fallback={<span>Checking auth…</span>}
        >
          <div>Content</div>
        </RequireAuth>
      );
    }).not.toThrow();
  });
});
