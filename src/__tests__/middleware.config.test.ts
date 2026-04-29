/**
 * Middleware configuration tests
 *
 * Verifies that the Next.js middleware matcher is correctly configured to:
 *   • Guard all INVENTORY dashboard routes (/inventory and sub-paths)
 *   • Guard all SCAN mobile app routes (/scan and sub-paths)
 *   • Leave public routes unguarded (/, /api/auth/*, /api/telemetry, /case/*)
 *
 * These tests run the matcher patterns against known route paths using the
 * same pattern-matching logic that Next.js middleware applies at runtime.
 *
 * Pattern semantics (Next.js path-to-regexp):
 *   /inventory/:path*   — matches /inventory AND /inventory/anything/nested
 *   /scan/:path*        — matches /scan AND /scan/anything/nested
 *
 * Run: npx vitest run
 */

import { describe, it, expect } from "vitest";
import { config } from "../middleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape regex metacharacters in a literal string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Simulate Next.js middleware matcher pattern matching.
 *
 * Next.js converts matcher strings to path-to-regexp patterns at build time.
 * Here we replicate the matching logic for the patterns used in this project:
 *
 *   /inventory/:path*  → matches /inventory (empty tail) and /inventory/…
 *   /scan/:path*       → matches /scan (empty tail) and /scan/…
 *
 * The `:path*` suffix means "zero or more path segments", so both the bare
 * path and any nested path match.
 *
 * Conversion rules for `/<prefix>/:param<modifier>`:
 *   :param*  → (/.*)? — zero or more segments (the slash is part of the group)
 *   :param+  → (/[^/]+)+ — one or more segments
 *   :param   → /([^/]+) — exactly one segment
 *
 * The slash before `:param*` is consumed by the wildcard group, so the regex
 * prefix does NOT include a trailing slash.
 */
function matchesMiddlewareMatcher(pathname: string): boolean {
  const { matcher } = config;
  const patterns = Array.isArray(matcher) ? matcher : [matcher];

  for (const rawPattern of patterns) {
    // Split on the separator before the named param: /:paramName[*+]?
    // Regex: \/ followed by : + word chars + optional modifier (* or +)
    const splitRe = /\/:([\w]+)([*+]?)/;
    const parts = rawPattern.split(splitRe);

    if (parts.length === 1) {
      // No path param — exact match
      if (pathname === rawPattern) return true;
      continue;
    }

    // parts[0] = literal prefix (e.g. "/inventory")
    // parts[1] = param name  (e.g. "path")
    // parts[2] = modifier    (e.g. "*" | "+" | "")
    // parts[3] = remainder   (usually "")
    const prefix = parts[0];
    const modifier = parts[2];
    const remainder = parts.slice(3).join(""); // usually empty

    let tail: string;
    if (modifier === "*") {
      tail = "(/.*)?"; // zero or more segments with leading slash
    } else if (modifier === "+") {
      tail = "(/[^/]+)+"; // one or more segments
    } else {
      tail = "/([^/]+)"; // exactly one segment
    }

    const regexStr = `${escapeRegex(prefix)}${tail}${escapeRegex(remainder)}`;
    const regex = new RegExp(`^${regexStr}$`);

    if (regex.test(pathname)) {
      return true;
    }
  }

  return false;
}

// ─── Middleware config shape ───────────────────────────────────────────────────

describe("middleware config — shape", () => {
  it("exports a config object with a matcher property", () => {
    expect(config).toBeDefined();
    expect(config.matcher).toBeDefined();
  });

  it("matcher is an array", () => {
    expect(Array.isArray(config.matcher)).toBe(true);
  });

  it("matcher contains at least two entries (inventory + scan)", () => {
    expect((config.matcher as string[]).length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Protected routes — INVENTORY dashboard ───────────────────────────────────

describe("middleware config — INVENTORY routes are protected", () => {
  it("matches /inventory (bare path)", () => {
    expect(matchesMiddlewareMatcher("/inventory")).toBe(true);
  });

  it("matches /inventory/ (trailing slash)", () => {
    expect(matchesMiddlewareMatcher("/inventory/")).toBe(true);
  });

  it("matches /inventory?view=M1 — treated as the /inventory path", () => {
    // Middleware matcher only compares against the pathname, not query string.
    // Simulate by stripping the query part before matching.
    const pathname = "/inventory";
    expect(matchesMiddlewareMatcher(pathname)).toBe(true);
  });

  it("matches /inventory/CASE-001 (sub-path)", () => {
    expect(matchesMiddlewareMatcher("/inventory/CASE-001")).toBe(true);
  });

  it("matches /inventory/cases/CASE-001/detail (deeply nested)", () => {
    expect(matchesMiddlewareMatcher("/inventory/cases/CASE-001/detail")).toBe(true);
  });

  it("matches /inventory/settings", () => {
    expect(matchesMiddlewareMatcher("/inventory/settings")).toBe(true);
  });
});

// ─── Protected routes — SCAN mobile app ───────────────────────────────────────

describe("middleware config — SCAN routes are protected", () => {
  it("matches /scan (bare path)", () => {
    expect(matchesMiddlewareMatcher("/scan")).toBe(true);
  });

  it("matches /scan/ (trailing slash)", () => {
    expect(matchesMiddlewareMatcher("/scan/")).toBe(true);
  });

  it("matches /scan/CASE-001 (case detail)", () => {
    expect(matchesMiddlewareMatcher("/scan/CASE-001")).toBe(true);
  });

  it("matches /scan/CASE-001/inspect (SCAN inspect flow)", () => {
    expect(matchesMiddlewareMatcher("/scan/CASE-001/inspect")).toBe(true);
  });

  it("matches /scan/CASE-001/ship (SCAN ship flow)", () => {
    expect(matchesMiddlewareMatcher("/scan/CASE-001/ship")).toBe(true);
  });

  it("matches /scan/CASE-001/check-in (SCAN check-in flow)", () => {
    expect(matchesMiddlewareMatcher("/scan/CASE-001/check-in")).toBe(true);
  });

  it("matches /scan/CASE-001/damage (SCAN damage report flow)", () => {
    expect(matchesMiddlewareMatcher("/scan/CASE-001/damage")).toBe(true);
  });

  it("matches /scan/CASE-001/handoff (SCAN custody handoff flow)", () => {
    expect(matchesMiddlewareMatcher("/scan/CASE-001/handoff")).toBe(true);
  });

  it("matches /scan/CASE-001/associate (SCAN QR associate flow)", () => {
    expect(matchesMiddlewareMatcher("/scan/CASE-001/associate")).toBe(true);
  });

  it("matches deeply nested scan paths", () => {
    expect(matchesMiddlewareMatcher("/scan/a/b/c/d")).toBe(true);
  });
});

// ─── Public routes — must NOT be matched by middleware ────────────────────────

describe("middleware config — public routes are NOT protected", () => {
  it("does NOT match / (root login page)", () => {
    expect(matchesMiddlewareMatcher("/")).toBe(false);
  });

  it("does NOT match /api/auth/login (Kinde login handler)", () => {
    expect(matchesMiddlewareMatcher("/api/auth/login")).toBe(false);
  });

  it("does NOT match /api/auth/logout (Kinde logout handler)", () => {
    expect(matchesMiddlewareMatcher("/api/auth/logout")).toBe(false);
  });

  it("does NOT match /api/auth/kinde_callback (OAuth callback)", () => {
    expect(matchesMiddlewareMatcher("/api/auth/kinde_callback")).toBe(false);
  });

  it("does NOT match /api/auth/scan-login (SCAN login entry point)", () => {
    expect(matchesMiddlewareMatcher("/api/auth/scan-login")).toBe(false);
  });

  it("does NOT match /api/telemetry (server-to-server telemetry endpoint)", () => {
    expect(matchesMiddlewareMatcher("/api/telemetry")).toBe(false);
  });

  it("does NOT match /api/cases/map (map data API)", () => {
    expect(matchesMiddlewareMatcher("/api/cases/map")).toBe(false);
  });

  it("does NOT match /case/CASE-001 (QR deep-link redirect)", () => {
    expect(matchesMiddlewareMatcher("/case/CASE-001")).toBe(false);
  });

  it("does NOT match /_next/static (Next.js static assets)", () => {
    expect(matchesMiddlewareMatcher("/_next/static/chunks/main.js")).toBe(false);
  });

  it("does NOT match /favicon.ico", () => {
    expect(matchesMiddlewareMatcher("/favicon.ico")).toBe(false);
  });

  it("does NOT match /manifest.json", () => {
    expect(matchesMiddlewareMatcher("/manifest.json")).toBe(false);
  });
});

// ─── Matcher pattern format ────────────────────────────────────────────────────

describe("middleware config — matcher pattern format", () => {
  it("matcher includes a pattern for /inventory paths", () => {
    const patterns = config.matcher as string[];
    const hasInventory = patterns.some((p) =>
      p.startsWith("/inventory") && p.includes(":path")
    );
    expect(hasInventory).toBe(true);
  });

  it("matcher includes a pattern for /scan paths", () => {
    const patterns = config.matcher as string[];
    const hasScan = patterns.some((p) =>
      p.startsWith("/scan") && p.includes(":path")
    );
    expect(hasScan).toBe(true);
  });

  it("matcher does NOT include a catch-all that would match /api routes", () => {
    const patterns = config.matcher as string[];
    // Ensure no pattern like '/(.*)', '/:path*', or '/api' appears
    const hasDangerousCatchAll = patterns.some(
      (p) => p === "/(.*)" || p === "/:path*" || p.startsWith("/api")
    );
    expect(hasDangerousCatchAll).toBe(false);
  });

  it("matcher does NOT include the root path /", () => {
    const patterns = config.matcher as string[];
    const hasRoot = patterns.includes("/");
    expect(hasRoot).toBe(false);
  });
});
