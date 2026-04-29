/**
 * scan-actions.test.ts
 *
 * Unit tests for the SCAN app server actions (src/app/scan/actions.ts).
 *
 * Tests cover:
 *   1. scanLogout redirects to the Kinde logout endpoint
 *   2. The redirect target includes post_logout_redirect_url=/scan/login
 *   3. The redirect target does NOT accept user-supplied data
 *      (hardcoded to /scan/login — no open-redirect vulnerability)
 *
 * Mocking strategy:
 *   - next/navigation: mocked so `redirect()` throws a capturable error
 *     (same pattern used by Next.js internally; tests can `expect().rejects`).
 *
 * Note: "use server" directives are ignored in the test environment — the
 * module is imported like any other TypeScript module.  We do NOT need to
 * simulate the Next.js server action runtime to test the logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock: next/navigation ─────────────────────────────────────────────────

const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    // Simulate Next.js redirect() by throwing (it never returns normally)
    throw new Error(`REDIRECT:${url}`);
  },
}));

// ─── Import under test ─────────────────────────────────────────────────────

// Import AFTER vi.mock so the hoisted mock is in place
import { scanLogout } from "../actions";

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("scanLogout server action", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("calls redirect() with the Kinde logout endpoint", async () => {
    await expect(scanLogout()).rejects.toThrow(/REDIRECT:/);

    expect(redirectMock).toHaveBeenCalledOnce();
  });

  it("redirects to /api/auth/logout (Kinde logout handler)", async () => {
    await expect(scanLogout()).rejects.toThrow();

    const redirectArg = redirectMock.mock.calls[0][0] as string;
    expect(redirectArg).toContain("/api/auth/logout");
  });

  it("includes post_logout_redirect_url=/scan/login in the redirect URL", async () => {
    await expect(scanLogout()).rejects.toThrow();

    const redirectArg = redirectMock.mock.calls[0][0] as string;
    expect(redirectArg).toContain("post_logout_redirect_url=/scan/login");
  });

  it("does NOT redirect to any external domain (no open-redirect)", async () => {
    await expect(scanLogout()).rejects.toThrow();

    const redirectArg = redirectMock.mock.calls[0][0] as string;
    // The redirect target must be root-relative, not an absolute URL
    expect(redirectArg).not.toMatch(/^https?:\/\//);
    expect(redirectArg).not.toContain("evil.example.com");
  });

  it("always redirects to /scan/login (hardcoded destination, no user input)", async () => {
    await expect(scanLogout()).rejects.toThrow();

    const redirectArg = redirectMock.mock.calls[0][0] as string;
    // The post_logout_redirect_url value must always be /scan/login
    const url = new URL(redirectArg, "http://localhost");
    expect(url.searchParams.get("post_logout_redirect_url")).toBe("/scan/login");
  });
});
