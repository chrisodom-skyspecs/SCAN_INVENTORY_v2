/**
 * @vitest-environment jsdom
 *
 * src/lib/__tests__/use-auth-from-kinde.test.tsx
 *
 * Unit tests for useAuthFromKinde — the Kinde → Convex auth adapter hook.
 *
 * This hook is the critical bridge between Kinde authentication and Convex's
 * ConvexProviderWithAuth. It exposes:
 *   { isLoading, isAuthenticated, fetchAccessToken }
 *
 * These tests verify that:
 *   1. Loading state — isLoading=true while Kinde session is resolving
 *   2. Unauthenticated — isAuthenticated=false, fetchAccessToken returns null
 *   3. Authenticated — isAuthenticated=true, fetchAccessToken returns token
 *   4. Force refresh — refreshData() is called before getToken()
 *   5. Refresh failure — error is swallowed, getToken() still called
 *   6. Null/undefined fallbacks — nullish coalescing for isLoading/isAuthenticated
 *
 * Why this matters for AC 3
 * ──────────────────────────
 * The AC requires confirming that:
 *   - The ConvexProviderWithAuth is wired with the Kinde session token
 *   - Protected queries/mutations succeed when authenticated
 *   - Protected queries/mutations are rejected when unauthenticated
 *
 * The auth wiring happens entirely through this hook. When isAuthenticated=false
 * or fetchAccessToken returns null, Convex sends no Authorization header and
 * `ctx.auth.getUserIdentity()` returns null in all handlers — causing
 * [AUTH_REQUIRED] to be thrown by requireAuth() / requireCurrentUser().
 *
 * Run: npx vitest run src/lib/__tests__/use-auth-from-kinde.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAuthFromKinde } from "../use-auth-from-kinde";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

// useKindeBrowserClient state — mutated per-test via beforeEach/per-test setup
const mockKindeState = {
  accessToken: null as { sub?: string } | null,
  isAuthenticated: false as boolean | null,
  isLoading: true as boolean | null,
  getToken: vi.fn<() => string | null | undefined>(),
  refreshData: vi.fn<() => Promise<void>>(),
};

vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: () => mockKindeState,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Configure the mock Kinde state.
 * Defaults to unauthenticated, not loading.
 */
function setupKinde({
  isAuthenticated = false,
  isLoading = false,
  token = null as string | null,
  refreshError = null as Error | null,
}: {
  isAuthenticated?: boolean | null;
  isLoading?: boolean | null;
  token?: string | null;
  refreshError?: Error | null;
} = {}) {
  mockKindeState.accessToken = token ? { sub: "kinde_user_123" } : null;
  mockKindeState.isAuthenticated = isAuthenticated;
  mockKindeState.isLoading = isLoading;
  mockKindeState.getToken.mockReturnValue(token);
  if (refreshError) {
    mockKindeState.refreshData.mockRejectedValue(refreshError);
  } else {
    mockKindeState.refreshData.mockResolvedValue(undefined);
  }
}

// ─── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 1. Loading state ─────────────────────────────────────────────────────────

describe("useAuthFromKinde — loading state", () => {
  it("returns isLoading=true when Kinde session is resolving", () => {
    setupKinde({ isLoading: true, isAuthenticated: false });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isLoading).toBe(true);
  });

  it("returns isAuthenticated=false while loading", () => {
    setupKinde({ isLoading: true, isAuthenticated: false });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("defaults isLoading to true when Kinde returns null", () => {
    setupKinde({ isLoading: null });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isLoading).toBe(true);
  });

  it("defaults isAuthenticated to false when Kinde returns null", () => {
    setupKinde({ isAuthenticated: null, isLoading: false });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isAuthenticated).toBe(false);
  });
});

// ─── 2. Unauthenticated state ─────────────────────────────────────────────────

describe("useAuthFromKinde — unauthenticated state", () => {
  it("returns isAuthenticated=false when user is not signed in", () => {
    setupKinde({ isAuthenticated: false, isLoading: false, token: null });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("returns isLoading=false when session has resolved without auth", () => {
    setupKinde({ isAuthenticated: false, isLoading: false });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isLoading).toBe(false);
  });

  it("fetchAccessToken returns null when not authenticated (getToken returns null)", async () => {
    setupKinde({ isAuthenticated: false, isLoading: false, token: null });
    const { result } = renderHook(() => useAuthFromKinde());
    const token = await result.current.fetchAccessToken({ forceRefreshToken: false });
    expect(token).toBeNull();
  });

  it("fetchAccessToken returns null when getToken returns undefined", async () => {
    setupKinde({ isAuthenticated: false, isLoading: false });
    // getToken() returns undefined — this should coalesce to null
    mockKindeState.getToken.mockReturnValue(undefined);
    const { result } = renderHook(() => useAuthFromKinde());
    const token = await result.current.fetchAccessToken({ forceRefreshToken: false });
    expect(token).toBeNull();
  });

  it("does NOT call refreshData when forceRefreshToken=false and unauthenticated", async () => {
    setupKinde({ isAuthenticated: false, isLoading: false, token: null });
    const { result } = renderHook(() => useAuthFromKinde());
    await result.current.fetchAccessToken({ forceRefreshToken: false });
    expect(mockKindeState.refreshData).not.toHaveBeenCalled();
  });
});

// ─── 3. Authenticated state ───────────────────────────────────────────────────

describe("useAuthFromKinde — authenticated state", () => {
  const MOCK_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJraW5kZV91c2VyXzEyMyJ9.sig";

  it("returns isAuthenticated=true when user has a valid session", () => {
    setupKinde({ isAuthenticated: true, isLoading: false, token: MOCK_TOKEN });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("returns isLoading=false when session is fully resolved", () => {
    setupKinde({ isAuthenticated: true, isLoading: false, token: MOCK_TOKEN });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isLoading).toBe(false);
  });

  it("keeps Convex loading while Kinde token claims are not hydrated", () => {
    setupKinde({ isAuthenticated: true, isLoading: false, token: null });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("fetchAccessToken returns the Kinde access token string", async () => {
    setupKinde({ isAuthenticated: true, isLoading: false, token: MOCK_TOKEN });
    const { result } = renderHook(() => useAuthFromKinde());
    const token = await result.current.fetchAccessToken({ forceRefreshToken: false });
    expect(token).toBe(MOCK_TOKEN);
  });

  it("fetchAccessToken does not call refreshData when forceRefreshToken=false", async () => {
    setupKinde({ isAuthenticated: true, isLoading: false, token: MOCK_TOKEN });
    const { result } = renderHook(() => useAuthFromKinde());
    await result.current.fetchAccessToken({ forceRefreshToken: false });
    expect(mockKindeState.refreshData).not.toHaveBeenCalled();
  });
});

// ─── 4. Forced token refresh ──────────────────────────────────────────────────

describe("useAuthFromKinde — forced token refresh", () => {
  const MOCK_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJraW5kZV91c2VyXzEyMyJ9.sig";

  it("calls refreshData() before getToken() when forceRefreshToken=true", async () => {
    setupKinde({ isAuthenticated: true, isLoading: false, token: MOCK_TOKEN });

    const callOrder: string[] = [];
    mockKindeState.refreshData.mockImplementation(async () => {
      callOrder.push("refreshData");
    });
    mockKindeState.getToken.mockImplementation(() => {
      callOrder.push("getToken");
      return MOCK_TOKEN;
    });

    const { result } = renderHook(() => useAuthFromKinde());
    await result.current.fetchAccessToken({ forceRefreshToken: true });

    expect(callOrder).toEqual(["refreshData", "getToken"]);
  });

  it("still returns the token even after a forced refresh", async () => {
    setupKinde({ isAuthenticated: true, isLoading: false, token: MOCK_TOKEN });
    const { result } = renderHook(() => useAuthFromKinde());
    const token = await result.current.fetchAccessToken({ forceRefreshToken: true });
    expect(token).toBe(MOCK_TOKEN);
  });

  it("calls refreshData exactly once when forceRefreshToken=true", async () => {
    setupKinde({ isAuthenticated: true, isLoading: false, token: MOCK_TOKEN });
    const { result } = renderHook(() => useAuthFromKinde());
    await result.current.fetchAccessToken({ forceRefreshToken: true });
    expect(mockKindeState.refreshData).toHaveBeenCalledTimes(1);
  });
});

// ─── 5. Refresh failure handling ─────────────────────────────────────────────

describe("useAuthFromKinde — refresh failure is non-fatal", () => {
  const MOCK_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJraW5kZV91c2VyXzEyMyJ9.sig";

  it("does NOT throw when refreshData() rejects", async () => {
    setupKinde({
      isAuthenticated: true,
      isLoading: false,
      token: MOCK_TOKEN,
      refreshError: new Error("session refresh failed"),
    });

    const { result } = renderHook(() => useAuthFromKinde());
    // Should NOT throw — error is swallowed internally
    await expect(
      result.current.fetchAccessToken({ forceRefreshToken: true })
    ).resolves.not.toThrow();
  });

  it("still calls getToken() after refreshData() fails", async () => {
    setupKinde({
      isAuthenticated: true,
      isLoading: false,
      token: MOCK_TOKEN,
      refreshError: new Error("network timeout"),
    });

    const { result } = renderHook(() => useAuthFromKinde());
    await result.current.fetchAccessToken({ forceRefreshToken: true });

    // getToken should still be called after the failed refresh
    expect(mockKindeState.getToken).toHaveBeenCalled();
  });

  it("returns existing token even after refreshData() fails", async () => {
    setupKinde({
      isAuthenticated: true,
      isLoading: false,
      token: MOCK_TOKEN,
      refreshError: new Error("no request context"),
    });

    const { result } = renderHook(() => useAuthFromKinde());
    const token = await result.current.fetchAccessToken({ forceRefreshToken: true });

    // Should return the existing (possibly expired) token rather than null
    expect(token).toBe(MOCK_TOKEN);
  });

  it("returns null when refreshData() fails AND getToken() returns null", async () => {
    setupKinde({
      isAuthenticated: false,
      isLoading: false,
      token: null,
      refreshError: new Error("no session"),
    });

    const { result } = renderHook(() => useAuthFromKinde());
    const token = await result.current.fetchAccessToken({ forceRefreshToken: true });
    expect(token).toBeNull();
  });
});

// ─── 6. Convex wiring correctness ────────────────────────────────────────────

describe("useAuthFromKinde — ConvexProviderWithAuth wiring contract", () => {
  /**
   * These tests verify the exact contract that ConvexProviderWithAuth requires:
   * https://docs.convex.dev/auth/advanced/custom-auth
   *
   * The hook must return:
   *   { isLoading: boolean, isAuthenticated: boolean, fetchAccessToken: fn }
   */

  it("returns all three required fields for ConvexProviderWithAuth", () => {
    setupKinde({ isLoading: false, isAuthenticated: false, token: null });
    const { result } = renderHook(() => useAuthFromKinde());

    expect(typeof result.current.isLoading).toBe("boolean");
    expect(typeof result.current.isAuthenticated).toBe("boolean");
    expect(typeof result.current.fetchAccessToken).toBe("function");
  });

  it("fetchAccessToken is always a function regardless of auth state", () => {
    // Loading
    setupKinde({ isLoading: true });
    const { result: r1 } = renderHook(() => useAuthFromKinde());
    expect(typeof r1.current.fetchAccessToken).toBe("function");

    // Unauthenticated
    setupKinde({ isLoading: false, isAuthenticated: false });
    const { result: r2 } = renderHook(() => useAuthFromKinde());
    expect(typeof r2.current.fetchAccessToken).toBe("function");

    // Authenticated
    setupKinde({ isLoading: false, isAuthenticated: true, token: "tok" });
    const { result: r3 } = renderHook(() => useAuthFromKinde());
    expect(typeof r3.current.fetchAccessToken).toBe("function");
  });

  it("isLoading is always a boolean (never null/undefined)", () => {
    // null from Kinde → true (safe default)
    setupKinde({ isLoading: null });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isLoading).not.toBeNull();
    expect(result.current.isLoading).not.toBeUndefined();
  });

  it("isAuthenticated is always a boolean (never null/undefined)", () => {
    // null from Kinde → false (safe default)
    setupKinde({ isAuthenticated: null });
    const { result } = renderHook(() => useAuthFromKinde());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isAuthenticated).not.toBeNull();
    expect(result.current.isAuthenticated).not.toBeUndefined();
  });

  it("fetchAccessToken returns Promise<string|null> — never undefined", async () => {
    // Authenticated → string
    setupKinde({ isAuthenticated: true, isLoading: false, token: "bearer-tok" });
    const { result: r1 } = renderHook(() => useAuthFromKinde());
    const tok = await r1.current.fetchAccessToken({ forceRefreshToken: false });
    expect(typeof tok === "string" || tok === null).toBe(true);
    expect(tok).not.toBeUndefined();

    // Unauthenticated → null (not undefined)
    setupKinde({ isAuthenticated: false, isLoading: false, token: null });
    const { result: r2 } = renderHook(() => useAuthFromKinde());
    const notok = await r2.current.fetchAccessToken({ forceRefreshToken: false });
    expect(notok).toBeNull();
  });
});
