/**
 * @vitest-environment node
 *
 * p50 Latency Benchmark — GET /api/cases/map (wired route handler)
 *
 * Invokes the production Next.js App Router handler
 * (src/app/api/cases/map/route.ts) end-to-end and asserts the p50 (median)
 * response time across 101 samples remains under 200ms.
 *
 * Why "end-to-end"?
 *   The handler covers more than just data assembly:
 *     1. Env resolution   — reads NEXT_PUBLIC_CONVEX_URL / CONVEX_SITE_URL
 *     2. Param validation — mode, bounds (all-or-nothing), filters JSON
 *     3. URL construction — builds the upstream Convex site URL
 *     4. Upstream fetch   — awaits the mocked Response
 *     5. JSON extraction  — response.json()
 *     6. NextResponse     — wraps the payload with the correct status code
 *
 *   The upstream Convex HTTP call is replaced with a vi.stubGlobal fetch mock
 *   that returns a pre-built M1Response payload (250-case fleet), so the test
 *   runs without a live deployment while exercising every code path in the handler.
 *
 * Fleet size:
 *   250 cases — realistic mid-fleet size; larger than the 5-case smoke test
 *   but small enough that assembly latency inside the mock is negligible
 *   (<1ms), keeping the measurement focused on the handler's own overhead.
 *
 * Run: npx vitest run src/app/api/cases/map/__tests__/route.latency.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/cases/map/route";
import type { M1Response } from "@/types/cases-map";

// ─── Mock upstream payload (250-case M1 fleet) ───────────────────────────────

const CASE_STATUSES = [
  "assembled",
  "deployed",
  "in_field",
  "shipping",
  "returned",
] as const;

/** Pre-build a realistic 250-case M1Response once, reused across all iterations. */
function buildMockM1Response(caseCount = 250): M1Response {
  const now = Date.now();
  const byStatus: Record<string, number> = {};
  for (const s of CASE_STATUSES) byStatus[s] = 0;

  const cases = Array.from({ length: caseCount }, (_, i) => {
    const idx = i + 1;
    const status = CASE_STATUSES[i % CASE_STATUSES.length];
    byStatus[status] += 1;
    return {
      _id: `case_${idx}`,
      label: `CASE-${String(idx).padStart(4, "0")}`,
      status,
      lat: 35 + (i % 20) * 0.4,
      lng: -100 + (i % 30) * 0.8,
      locationName: `Site-${idx}`,
      assigneeName: idx % 4 !== 0 ? `Technician ${(idx % 10) + 1}` : undefined,
      updatedAt: now - 3_600_000 * (idx % 24),
    };
  });

  return {
    mode: "M1",
    ts: now,
    cases,
    summary: {
      total: caseCount,
      withLocation: caseCount,
      byStatus,
    },
  };
}

const MOCK_M1_BODY = buildMockM1Response(250);
const MOCK_M1_JSON = JSON.stringify(MOCK_M1_BODY);

// ─── Async p50 helper ─────────────────────────────────────────────────────────

/**
 * Run `fn` exactly `iterations` times, collect wall-clock durations in ms,
 * and return the 50th-percentile value (p50 / median).
 */
async function measureP50(
  fn: () => Promise<void>,
  iterations = 101
): Promise<number> {
  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    durations.push(performance.now() - t0);
  }
  durations.sort((a, b) => a - b);
  return durations[Math.floor(iterations / 2)];
}

// ─── Test suite ───────────────────────────────────────────────────────────────

const BASE_URL = "http://localhost:3000";
const ITERATIONS = 101;
const P50_BUDGET_MS = 200;
const TEST_CONVEX_URL = "https://test-deploy-abc123.convex.cloud";

describe("GET /api/cases/map — wired route handler p50 latency < 200ms", () => {
  beforeAll(() => {
    // Provide a valid Convex deployment URL so the handler resolves a site URL
    // rather than short-circuiting with a 503.
    process.env.NEXT_PUBLIC_CONVEX_URL = TEST_CONVEX_URL;

    // Stub global fetch — intercepts the upstream Convex HTTP call inside the
    // route handler and returns a pre-built 200 response without any network I/O.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, _init?: unknown) => {
        return new Response(MOCK_M1_JSON, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  });

  // ── Single-sample sanity checks ─────────────────────────────────────────────
  // Confirm the handler is wired correctly before running the benchmark.

  it("returns 200 with M1 payload for a plain request", async () => {
    const req = new NextRequest(`${BASE_URL}/api/cases/map`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as M1Response;
    expect(body.mode).toBe("M1");
    expect(typeof body.ts).toBe("number");
    expect(Array.isArray(body.cases)).toBe(true);
    expect(body.summary.total).toBe(250);
  });

  it("returns 400 for an invalid mode without reaching fetch", async () => {
    const req = new NextRequest(`${BASE_URL}/api/cases/map?mode=M9`);
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for partial bounds params without reaching fetch", async () => {
    const req = new NextRequest(
      `${BASE_URL}/api/cases/map?swLat=40.0&swLng=-100.0`
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed filters JSON without reaching fetch", async () => {
    const req = new NextRequest(
      `${BASE_URL}/api/cases/map?filters=%7Binvalid`
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  // ── p50 latency benchmarks ──────────────────────────────────────────────────

  it(`p50 < ${P50_BUDGET_MS}ms — default M1 request (${ITERATIONS} iterations)`, async () => {
    const p50 = await measureP50(async () => {
      const req = new NextRequest(`${BASE_URL}/api/cases/map`);
      const res = await GET(req);
      // Consume the response body so stream resources are released
      await res.json();
      expect(res.status).toBe(200);
    }, ITERATIONS);

    // Report actual p50 as a label for easier debugging in CI output
    console.log(`[latency] default M1  p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`p50 < ${P50_BUDGET_MS}ms — M1 with viewport bounds (${ITERATIONS} iterations)`, async () => {
    const p50 = await measureP50(async () => {
      const req = new NextRequest(
        `${BASE_URL}/api/cases/map?mode=M1&swLat=40.0&swLng=-130.0&neLat=50.0&neLng=-60.0`
      );
      const res = await GET(req);
      await res.json();
      expect(res.status).toBe(200);
    }, ITERATIONS);

    console.log(`[latency] M1 + bounds p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`p50 < ${P50_BUDGET_MS}ms — M1 with status + missionId filters (${ITERATIONS} iterations)`, async () => {
    const filters = encodeURIComponent(
      JSON.stringify({ status: ["assembled", "deployed"], missionId: "missions_1" })
    );

    const p50 = await measureP50(async () => {
      const req = new NextRequest(
        `${BASE_URL}/api/cases/map?mode=M1&filters=${filters}`
      );
      const res = await GET(req);
      await res.json();
      expect(res.status).toBe(200);
    }, ITERATIONS);

    console.log(`[latency] M1 + filters p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`p50 < ${P50_BUDGET_MS}ms — M1 with bounds AND filters combined (${ITERATIONS} iterations)`, async () => {
    const filters = encodeURIComponent(
      JSON.stringify({ status: ["in_field"], assigneeId: "user_3" })
    );

    const p50 = await measureP50(async () => {
      const req = new NextRequest(
        `${BASE_URL}/api/cases/map?mode=M1&swLat=35.0&swLng=-110.0&neLat=45.0&neLng=-80.0&filters=${filters}`
      );
      const res = await GET(req);
      await res.json();
      expect(res.status).toBe(200);
    }, ITERATIONS);

    console.log(`[latency] M1 + bounds + filters p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });
});
