/**
 * Unit tests: cases-map-api.ts — response serialization helpers
 *
 * Tests the three serialization layers introduced in Sub-AC 2:
 *   1. buildCasesMapUrl   — URL construction from typed params
 *   2. serializeSuccessResponse — 200 body → { ok:true, status:200, data }
 *   3. serializeErrorResponse   — 4xx/5xx body → { ok:false, status, error }
 *   4. fetchCasesMap (integration) — mocked fetch → CasesMapApiResponse
 *
 * All tests run in the vitest `node` environment (no DOM required).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildCasesMapUrl,
  serializeSuccessResponse,
  serializeErrorResponse,
  fetchCasesMap,
} from "../cases-map-api";
import type { CasesMapApiResponse } from "@/types/cases-map";
import type { M1Response, M2Response } from "../../../convex/maps";

// ─── buildCasesMapUrl ─────────────────────────────────────────────────────────

describe("buildCasesMapUrl", () => {
  it("returns a relative URL with no params (default mode)", () => {
    const url = buildCasesMapUrl();
    expect(url).toBe("/api/cases/map");
  });

  it("includes mode param when provided", () => {
    const url = buildCasesMapUrl({ mode: "M3" });
    expect(url).toBe("/api/cases/map?mode=M3");
  });

  it("includes all four bounds params", () => {
    const url = buildCasesMapUrl({
      mode: "M1",
      swLat: "40.0",
      swLng: "-130.0",
      neLat: "50.0",
      neLng: "-60.0",
    });
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.get("swLat")).toBe("40.0");
    expect(parsed.searchParams.get("swLng")).toBe("-130.0");
    expect(parsed.searchParams.get("neLat")).toBe("50.0");
    expect(parsed.searchParams.get("neLng")).toBe("-60.0");
  });

  it("URL-encodes the filters JSON value", () => {
    const filters = JSON.stringify({ status: ["assembled"], hasDamage: true });
    const url = buildCasesMapUrl({ mode: "M1", filters });
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.get("filters")).toBe(filters);
  });

  it("omits params that are undefined", () => {
    const url = buildCasesMapUrl({ mode: "M2" });
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.has("swLat")).toBe(false);
    expect(parsed.searchParams.has("filters")).toBe(false);
  });

  it("returns an absolute URL when base is provided", () => {
    const url = buildCasesMapUrl({ mode: "M1" }, "https://app.example.com");
    expect(url).toBe("https://app.example.com/api/cases/map?mode=M1");
  });

  it("handles all five valid modes", () => {
    for (const mode of ["M1", "M2", "M3", "M4", "M5"] as const) {
      const url = buildCasesMapUrl({ mode });
      expect(url).toBe(`/api/cases/map?mode=${mode}`);
    }
  });

  it("does not include mode when not specified (no default injection)", () => {
    // Clients that want the default M1 behaviour can omit mode entirely;
    // the route handler defaults to M1 server-side.
    const url = buildCasesMapUrl({});
    expect(url).not.toContain("mode=");
  });
});

// ─── serializeSuccessResponse ─────────────────────────────────────────────────

describe("serializeSuccessResponse", () => {
  it("wraps the body in { ok:true, status:200, data }", () => {
    const body: M1Response = {
      mode: "M1",
      ts: Date.now(),
      cases: [],
      summary: { total: 0, withLocation: 0, byStatus: {} },
    };
    const result = serializeSuccessResponse(body);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    // TypeScript narrows to the success branch here
    if (!result.ok) throw new Error("Expected ok=true");
    expect(result.data).toBe(body); // same reference — no cloning
  });

  it("preserves the mode discriminant in data", () => {
    const bodies = [
      { mode: "M1" as const, ts: 0, cases: [], summary: { total: 0, withLocation: 0, byStatus: {} } },
      { mode: "M2" as const, ts: 0, missions: [], unassigned: [], summary: { total: 0, totalMissions: 0, byMissionStatus: {} } },
    ] as const;

    for (const body of bodies) {
      const result = serializeSuccessResponse(body);
      if (!result.ok) throw new Error("Expected ok=true");
      expect((result.data as { mode: string }).mode).toBe(body.mode);
    }
  });

  it("returns the CasesMapApiResponse ok=true shape", () => {
    const result: CasesMapApiResponse = serializeSuccessResponse({ mode: "M1" });
    expect(result).toMatchObject({ ok: true, status: 200 });
    // TypeScript discriminant narrows 'data' field (no 'error' field)
    expect("data" in result).toBe(true);
    expect("error" in result).toBe(false);
  });
});

// ─── serializeErrorResponse ───────────────────────────────────────────────────

describe("serializeErrorResponse", () => {
  it("returns ok=false for HTTP 400 with body { error, status }", () => {
    const body = { error: "Invalid mode", status: 400 };
    const result = serializeErrorResponse(400, body);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toBe("Invalid mode");
  });

  it("returns ok=false with status=503 for HTTP 503", () => {
    const body = { error: "Service not configured", status: 503 };
    const result = serializeErrorResponse(503, body);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toBe("Service not configured");
  });

  it("returns ok=false with status=500 for HTTP 500", () => {
    const body = { error: "Internal server error", status: 500 };
    const result = serializeErrorResponse(500, body);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("maps unexpected HTTP codes (e.g. 422, 502) to status=500", () => {
    const result = serializeErrorResponse(422, { error: "Unprocessable" });
    expect(result.status).toBe(500);
  });

  it("maps 405 Method Not Allowed to status=500", () => {
    const result = serializeErrorResponse(405, { error: "Method not allowed" });
    expect(result.status).toBe(500);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toBe("Method not allowed");
  });

  it("uses a fallback error message when body lacks an error field", () => {
    const result = serializeErrorResponse(500, null);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toMatch(/500/);
  });

  it("uses a fallback when body is a plain string", () => {
    const result = serializeErrorResponse(400, "bad request");
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toMatch(/400/);
  });

  it("uses a fallback when body has a non-string error field", () => {
    const result = serializeErrorResponse(400, { error: 42 });
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toMatch(/400/);
  });

  it("never sets ok=true", () => {
    const codes = [400, 401, 403, 404, 422, 500, 502, 503, 504];
    for (const code of codes) {
      const result = serializeErrorResponse(code, { error: "fail" });
      expect(result.ok).toBe(false);
    }
  });

  it("returns the CasesMapApiResponse ok=false shape", () => {
    const result: CasesMapApiResponse = serializeErrorResponse(400, {
      error: "bad",
    });
    expect(result).toMatchObject({ ok: false });
    expect("error" in result).toBe(true);
    expect("data" in result).toBe(false);
  });

  it("extracts error message from body with extra fields", () => {
    const body = { error: "Bounds require all four params", status: 400, extra: "ignored" };
    const result = serializeErrorResponse(400, body);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toBe("Bounds require all four params");
  });
});

// ─── fetchCasesMap (mocked fetch) ─────────────────────────────────────────────

describe("fetchCasesMap", () => {
  // Store original fetch so we can restore it
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(
    status: number,
    body: unknown,
    ok = status >= 200 && status < 300
  ) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
    } as unknown as Response);
  }

  function mockFetchNetworkError() {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  }

  function mockFetchInvalidJson(status: number, ok: boolean) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);
  }

  // ── Success path ───────────────────────────────────────────────────────────

  it("returns ok=true with data for a 200 response", async () => {
    const m1Body: M1Response = {
      mode: "M1",
      ts: Date.now(),
      cases: [],
      summary: { total: 0, withLocation: 0, byStatus: {} },
    };
    mockFetch(200, m1Body);

    const result = await fetchCasesMap({ mode: "M1" });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    if (!result.ok) throw new Error("Expected ok=true");
    expect((result.data as M1Response).mode).toBe("M1");
  });

  it("calls fetch with the correct URL for mode=M2", async () => {
    const m2Body: M2Response = {
      mode: "M2",
      ts: Date.now(),
      missions: [],
      unassigned: [],
      summary: { total: 0, totalMissions: 0, byMissionStatus: {} },
    };
    mockFetch(200, m2Body);

    await fetchCasesMap({ mode: "M2" });
    const fetchArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url: string = fetchArgs[0];
    expect(url).toContain("/api/cases/map");
    expect(url).toContain("mode=M2");
  });

  it("includes bounds params in the URL when provided", async () => {
    mockFetch(200, { mode: "M1", ts: 0, cases: [], summary: { total: 0, withLocation: 0, byStatus: {} } });

    await fetchCasesMap({
      mode: "M1",
      swLat: "40.0",
      swLng: "-130.0",
      neLat: "50.0",
      neLng: "-60.0",
    });

    const url: string = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toContain("swLat=40.0");
    expect(url).toContain("neLat=50.0");
  });

  it("passes Accept: application/json header", async () => {
    mockFetch(200, { mode: "M1", ts: 0, cases: [], summary: { total: 0, withLocation: 0, byStatus: {} } });

    await fetchCasesMap({ mode: "M1" });

    const fetchOptions = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const headers = fetchOptions?.headers as Record<string, string>;
    expect(headers?.["Accept"]).toBe("application/json");
  });

  it("passes cache: no-store by default", async () => {
    mockFetch(200, { mode: "M1", ts: 0, cases: [], summary: { total: 0, withLocation: 0, byStatus: {} } });

    await fetchCasesMap({ mode: "M1" });

    const fetchOptions = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(fetchOptions?.cache).toBe("no-store");
  });

  // ── Error paths ───────────────────────────────────────────────────────────

  it("returns ok=false, status=400 for a 400 response", async () => {
    mockFetch(400, { error: "Invalid mode", status: 400 }, false);

    const result = await fetchCasesMap({ mode: "M1" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toBe("Invalid mode");
  });

  it("returns ok=false, status=503 for a 503 response", async () => {
    mockFetch(503, { error: "Service not configured", status: 503 }, false);

    const result = await fetchCasesMap({});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toBe("Service not configured");
  });

  it("returns ok=false, status=500 for a 500 response", async () => {
    mockFetch(500, { error: "Internal server error", status: 500 }, false);

    const result = await fetchCasesMap({ mode: "M1" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("returns ok=false, status=500 on network error", async () => {
    mockFetchNetworkError();

    const result = await fetchCasesMap({ mode: "M1" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toMatch(/network error/i);
  });

  it("returns ok=false, status=500 when response is not valid JSON", async () => {
    mockFetchInvalidJson(200, true);

    const result = await fetchCasesMap({ mode: "M1" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toMatch(/invalid response/i);
  });

  it("returns ok=false, status=500 when 500 response body is not valid JSON", async () => {
    mockFetchInvalidJson(500, false);

    const result = await fetchCasesMap({ mode: "M1" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    if (result.ok) throw new Error("Expected ok=false");
    expect(result.error).toMatch(/invalid response/i);
  });

  // ── fetch called with no params ───────────────────────────────────────────

  it("works with no params (uses default URL /api/cases/map)", async () => {
    mockFetch(200, {
      mode: "M1",
      ts: 0,
      cases: [],
      summary: { total: 0, withLocation: 0, byStatus: {} },
    });

    const result = await fetchCasesMap();
    expect(result.ok).toBe(true);
    const url: string = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe("/api/cases/map");
  });

  // ── Custom options forwarding ─────────────────────────────────────────────

  it("forwards a custom AbortSignal via options.signal", async () => {
    mockFetch(200, { mode: "M1", ts: 0, cases: [], summary: { total: 0, withLocation: 0, byStatus: {} } });

    const controller = new AbortController();
    await fetchCasesMap({ mode: "M1" }, { signal: controller.signal });

    const fetchOptions = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(fetchOptions?.signal).toBe(controller.signal);
  });
});

// ─── Round-trip: buildCasesMapUrl + serializeSuccessResponse ─────────────────

describe("response serialization round-trip", () => {
  it("URL built by buildCasesMapUrl round-trips mode through URLSearchParams", () => {
    const modes = ["M1", "M2", "M3", "M4", "M5"] as const;
    for (const mode of modes) {
      const url = buildCasesMapUrl({ mode });
      const parsed = new URL(url, "http://localhost");
      expect(parsed.searchParams.get("mode")).toBe(mode);
    }
  });

  it("serializeSuccessResponse then destructure preserves all M1 fields", () => {
    const m1: M1Response = {
      mode: "M1",
      ts: 1_700_000_000_000,
      cases: [
        {
          _id: "case_1",
          label: "CASE-0001",
          status: "assembled",
          lat: 47.6,
          lng: -122.3,
          updatedAt: 1_700_000_000_000,
        },
      ],
      summary: {
        total: 1,
        withLocation: 1,
        byStatus: { assembled: 1 },
      },
    };

    const response = serializeSuccessResponse(m1);
    if (!response.ok) throw new Error("Expected ok=true");
    const data = response.data as M1Response;

    expect(data.mode).toBe("M1");
    expect(data.ts).toBe(1_700_000_000_000);
    expect(data.cases).toHaveLength(1);
    expect(data.cases[0]._id).toBe("case_1");
    expect(data.summary.total).toBe(1);
    expect(data.summary.byStatus).toEqual({ assembled: 1 });
  });

  it("serializeErrorResponse preserves all CasesMapErrorResponse fields", () => {
    const errors: Array<[number, string]> = [
      [400, "Invalid mode"],
      [400, 'Invalid "filters" parameter — must be valid JSON'],
      [400, "Bounds require all four params: swLat, swLng, neLat, neLng"],
      [503, "Service not configured: NEXT_PUBLIC_CONVEX_URL is missing"],
      [500, "Internal server error"],
    ];

    for (const [httpStatus, errorMsg] of errors) {
      const result = serializeErrorResponse(httpStatus, {
        error: errorMsg,
        status: httpStatus,
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBe(errorMsg);
    }
  });
});
