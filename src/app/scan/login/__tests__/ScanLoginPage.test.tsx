// @vitest-environment jsdom

/**
 * ScanLoginPage.test.tsx
 *
 * Unit tests for the /scan/login page component.
 *
 * Tests cover:
 *   1. Unauthenticated state — login card renders with sign-in button
 *   2. Correct login URL is built from post_login_redirect_url param
 *   3. Open-redirect protection — non-relative returnTo is sanitised to /scan
 *   4. Default redirect (/scan) when no query param is present
 *   5. Authenticated redirect — page calls redirect("/scan")
 *   6. Accessibility — ARIA labels, heading structure, focus indicators
 *
 * Mocking strategy:
 *   - @kinde-oss/kinde-auth-nextjs/server: mocked to control isAuthenticated()
 *   - next/navigation:  mocked to capture redirect() calls
 *   - searchParams:     provided as a resolved Promise (Next.js 15 async params)
 *
 * Note: This component is a Next.js 15 async server component.  We render it
 * by awaiting the default export (since it returns a Promise<JSX.Element>).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

// ─── DOM cleanup ──────────────────────────────────────────────────────────────

// Explicit cleanup prevents DOM accumulation between tests when
// @testing-library/react auto-cleanup has been reset by vi.resetModules().
afterEach(cleanup);

// ─── Mock: next/navigation ────────────────────────────────────────────────────

const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    // Simulate Next.js redirect() by throwing so component execution stops
    throw new Error(`REDIRECT:${url}`);
  },
}));

// ─── Mock: Kinde auth (server session) ───────────────────────────────────────

const isAuthenticatedMock = vi.fn<() => Promise<boolean>>();

vi.mock("@kinde-oss/kinde-auth-nextjs/server", () => ({
  getKindeServerSession: () => ({
    isAuthenticated: isAuthenticatedMock,
  }),
}));

// ─── Import under test ────────────────────────────────────────────────────────

// Import AFTER vi.mock calls so the hoisted mocks are in place
import ScanLoginPage from "../page";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build searchParams as Next.js 15 passes them: a resolved Promise.
 */
function makeSearchParams(
  params: Record<string, string> = {}
): Promise<Record<string, string>> {
  return Promise.resolve(params);
}

/**
 * Render the async server component by awaiting its return value.
 */
async function renderPage(
  searchParams: Promise<Record<string, string>> = makeSearchParams()
) {
  const jsx = await ScanLoginPage({
    searchParams: searchParams as Parameters<typeof ScanLoginPage>[0]["searchParams"],
  });
  return render(jsx as React.ReactElement);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScanLoginPage", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    isAuthenticatedMock.mockResolvedValue(false); // default: unauthenticated
  });

  // ── Unauthenticated state ──────────────────────────────────────────────────

  it("renders the main sign-in card when unauthenticated", async () => {
    await renderPage();

    // Card region with accessible label
    const main = screen.getByRole("main");
    expect(main).toBeTruthy();

    // Sign-in button exists
    const signInLink = screen.getByRole("link", {
      name: /sign in with your skyspecs account/i,
    });
    expect(signInLink).toBeTruthy();
  });

  it("renders the SkySpecs wordmark components", async () => {
    await renderPage();

    // The wordmark region has an aria-label wrapping "SkySpecs SCAN"
    const wordmark = screen.getByLabelText("SkySpecs SCAN");
    expect(wordmark).toBeTruthy();
  });

  it("renders the sign-in heading", async () => {
    await renderPage();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toBeTruthy();
    expect(heading.textContent).toMatch(/sign in to scan/i);
  });

  it("renders the access restriction footer note", async () => {
    await renderPage();

    expect(
      screen.getByText(/access is restricted to authorized skyspecs personnel/i)
    ).toBeTruthy();
  });

  it("renders the back-to-INVENTORY link", async () => {
    await renderPage();

    const inventoryLink = screen.getByRole("link", {
      name: /back to inventory dashboard/i,
    });
    expect(inventoryLink).toBeTruthy();
    expect(inventoryLink.getAttribute("href")).toBe("/");
  });

  // ── Sign-in URL construction ──────────────────────────────────────────────

  it("defaults sign-in href to /api/auth/login?post_login_redirect_url=/scan when no params", async () => {
    await renderPage(makeSearchParams());

    const signInLink = screen.getByRole("link", {
      name: /sign in with your skyspecs account/i,
    });
    const href = signInLink.getAttribute("href") ?? "";
    expect(href).toContain("/api/auth/login");
    expect(href).toContain(encodeURIComponent("/scan"));
  });

  it("includes post_login_redirect_url from searchParams in sign-in href", async () => {
    await renderPage(
      makeSearchParams({ post_login_redirect_url: "/scan/CASE-001" })
    );

    const signInLink = screen.getByRole("link", {
      name: /sign in with your skyspecs account/i,
    });
    const href = signInLink.getAttribute("href") ?? "";
    expect(href).toContain(encodeURIComponent("/scan/CASE-001"));
  });

  it("uses returnTo param as fallback when post_login_redirect_url is absent", async () => {
    await renderPage(
      makeSearchParams({ returnTo: "/scan/CASE-002/inspect" })
    );

    const signInLink = screen.getByRole("link", {
      name: /sign in with your skyspecs account/i,
    });
    const href = signInLink.getAttribute("href") ?? "";
    expect(href).toContain(encodeURIComponent("/scan/CASE-002/inspect"));
  });

  it("prefers post_login_redirect_url over returnTo when both are present", async () => {
    await renderPage(
      makeSearchParams({
        post_login_redirect_url: "/scan/PRIORITY",
        returnTo: "/scan/FALLBACK",
      })
    );

    const signInLink = screen.getByRole("link", {
      name: /sign in with your skyspecs account/i,
    });
    const href = signInLink.getAttribute("href") ?? "";
    expect(href).toContain(encodeURIComponent("/scan/PRIORITY"));
    expect(href).not.toContain(encodeURIComponent("/scan/FALLBACK"));
  });

  // ── Open-redirect protection ──────────────────────────────────────────────

  it("sanitises absolute URL in post_login_redirect_url to /scan", async () => {
    await renderPage(
      makeSearchParams({
        post_login_redirect_url: "https://evil.example.com/steal",
      })
    );

    const signInLink = screen.getByRole("link", {
      name: /sign in with your skyspecs account/i,
    });
    const href = signInLink.getAttribute("href") ?? "";
    // Must NOT redirect to external domain
    expect(href).not.toContain("evil.example.com");
    // Must fall back to safe /scan
    expect(href).toContain(encodeURIComponent("/scan"));
  });

  it("sanitises protocol-relative URL to /scan", async () => {
    await renderPage(
      makeSearchParams({ post_login_redirect_url: "//evil.example.com" })
    );

    const signInLink = screen.getByRole("link", {
      name: /sign in with your skyspecs account/i,
    });
    const href = signInLink.getAttribute("href") ?? "";
    expect(href).not.toContain("evil.example.com");
    expect(href).toContain(encodeURIComponent("/scan"));
  });

  // ── Authenticated redirect ────────────────────────────────────────────────

  it("calls redirect('/scan') when the user is already authenticated", async () => {
    isAuthenticatedMock.mockResolvedValue(true);

    await expect(renderPage()).rejects.toThrow("REDIRECT:/scan");

    expect(redirectMock).toHaveBeenCalledOnce();
    expect(redirectMock).toHaveBeenCalledWith("/scan");
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  it("card has role=main and accessible label", async () => {
    await renderPage();

    const main = screen.getByRole("main", {
      name: /sign in to skyspecs scan/i,
    });
    expect(main).toBeTruthy();
  });

  it("sign-in link has a descriptive aria-label", async () => {
    await renderPage();

    // Prefer aria-label over text content for accessible name
    const signInLink = screen.getByRole("link", {
      name: /sign in with your skyspecs account/i,
    });
    expect(signInLink.getAttribute("aria-label")).toMatch(
      /sign in with your skyspecs account/i
    );
  });

  it("has exactly one h1 heading", async () => {
    await renderPage();

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
  });
});
