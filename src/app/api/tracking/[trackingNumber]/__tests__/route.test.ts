/**
 * @vitest-environment node
 *
 * Unit tests — GET /api/tracking/[trackingNumber] route handler
 *
 * AC 380003 / Sub-AC 3: Implement read-only tracking endpoint integration with
 * request/response typing and error handling.
 *
 * Coverage matrix:
 *   1. Path param validation
 *      • missing                     → 400 INVALID_TRACKING_NUMBER
 *      • whitespace-only             → 400 INVALID_TRACKING_NUMBER
 *      • non-numeric / too short     → 400 INVALID_TRACKING_NUMBER
 *      • valid 12-digit Express      → 200 success
 *      • valid Door Tag (DT…)        → 200 success
 *
 *   2. Authorization header
 *      • missing                     → 401 AUTH_REQUIRED
 *      • non-Bearer                  → 401 AUTH_REQUIRED
 *      • Bearer with empty token     → 401 AUTH_REQUIRED
 *
 *   3. Service availability
 *      • NEXT_PUBLIC_CONVEX_URL missing → 503 SERVICE_UNAVAILABLE
 *
 *   4. Convex error translation (translateConvexError)
 *      • [INVALID_TRACKING_NUMBER]   → 400
 *      • [NOT_FOUND]                 → 404
 *      • [RATE_LIMITED]              → 429
 *      • [SERVER_ERROR]              → 502
 *      • [NETWORK_ERROR]             → 502
 *      • [PARSE_ERROR]               → 502
 *      • [AUTH_ERROR]                → 502
 *      • [CONFIGURATION_ERROR]       → 503
 *      • [UNKNOWN_ERROR]             → 500
 *      • [AUTH_REQUIRED]             → 401   (action-level auth guard)
 *      • plain Error w/o prefix      → 500
 *
 *   5. Response body shape
 *      • success body                → { ok: true, data: TrackingApiResult }
 *      • error body                  → { ok: false, code, message, status }
 *      • Cache-Control: no-store     → set on every response
 *
 *   6. Result reshaping
 *      • lastLocation derived from events[0]
 *      • lastLocation undefined when events empty
 *      • status defaults to "unknown" when missing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import {
  GET,
  translateConvexError,
  getConvexClient,
} from "../route";
import {
  TRACKING_API_STATUS_MAP,
  TRACKING_API_ERROR_CODES,
  CONVEX_ERROR_CODE_TO_API_CODE,
  type TrackingApiResponseBody,
  type TrackingApiErrorBody,
  type TrackingApiSuccessBody,
} from "@/types/tracking-api";

// ─── Convex client mock ───────────────────────────────────────────────────────
//
// `ConvexHttpClient` is imported by the route handler from `convex/browser`.
// We replace the constructor with a factory that returns a stub whose
// `setAuth` is a no-op and whose `action` resolves with whatever the test
// case configures via `setMockAction`.
//
// This keeps the test focused on the route's own validation / translation
// behaviour without spinning up a Convex deployment.

let mockActionImpl: (...args: unknown[]) => unknown = async () => {
  throw new Error("mockActionImpl not configured");
};

function setMockAction(impl: (...args: unknown[]) => unknown): void {
  mockActionImpl = impl;
}

vi.mock("convex/browser", () => {
  return {
    ConvexHttpClient: class MockConvexHttpClient {
      setAuth = vi.fn();
      action = vi.fn((...args: unknown[]) => mockActionImpl(...args));
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TN = "794644823741"; // 12-digit Express format

function buildRequest(opts?: {
  authHeader?: string | null;
}): NextRequest {
  const headers = new Headers();
  if (opts?.authHeader === undefined) {
    headers.set("authorization", "Bearer test-kinde-token");
  } else if (opts.authHeader !== null) {
    headers.set("authorization", opts.authHeader);
  }
  return new NextRequest("https://example.test/api/tracking/" + VALID_TN, {
    method: "GET",
    headers,
  });
}

function buildContext(trackingNumber: string) {
  return {
    params: Promise.resolve({ trackingNumber }),
  };
}

function buildSuccessActionResult(overrides?: Record<string, unknown>) {
  return {
    trackingNumber: VALID_TN,
    status: "in_transit",
    description: "In transit",
    estimatedDelivery: "2025-06-03T20:00:00Z",
    events: [
      {
        timestamp: "2025-06-02T14:30:00Z",
        eventType: "AR",
        description: "Arrived at FedEx location",
        location: { city: "Memphis", state: "TN", country: "US" },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  // Reset to a default success implementation for each test.
  mockActionImpl = async () => buildSuccessActionResult();
  // Default env: Convex URL is configured.
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://test.convex.cloud";
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Path param validation ─────────────────────────────────────────────────

describe("GET /api/tracking/[trackingNumber] — path validation", () => {
  it("returns 400 INVALID_TRACKING_NUMBER for empty path param", async () => {
    const res = await GET(buildRequest(), buildContext(""));
    expect(res.status).toBe(400);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.ok).toBe(false);
    expect(body.code).toBe("INVALID_TRACKING_NUMBER");
    expect(body.status).toBe(400);
  });

  it("returns 400 INVALID_TRACKING_NUMBER for whitespace-only param", async () => {
    const res = await GET(buildRequest(), buildContext("   "));
    expect(res.status).toBe(400);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("INVALID_TRACKING_NUMBER");
  });

  it("returns 400 for non-numeric tracking number", async () => {
    const res = await GET(buildRequest(), buildContext("abcdefghij"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("INVALID_TRACKING_NUMBER");
    expect(body.message.toLowerCase()).toContain("not a valid");
  });

  it("returns 400 for too-short numeric tracking number (< 10 digits)", async () => {
    const res = await GET(buildRequest(), buildContext("12345"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("INVALID_TRACKING_NUMBER");
  });

  it("accepts 12-digit Express number → 200", async () => {
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackingApiSuccessBody;
    expect(body.ok).toBe(true);
    expect(body.data.trackingNumber).toBe(VALID_TN);
  });

  it("accepts Door Tag format (DT + 12+ digits) → 200", async () => {
    const dt = "DT000123456789012";
    setMockAction(async () =>
      buildSuccessActionResult({ trackingNumber: dt }),
    );
    const res = await GET(buildRequest(), buildContext(dt));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackingApiSuccessBody;
    expect(body.data.trackingNumber).toBe(dt);
  });

  it("URL-decodes the tracking number param before validation", async () => {
    // "%20" is a literal space; should be stripped, leaving the digits.
    const encoded = encodeURIComponent(`  ${VALID_TN}  `);
    const res = await GET(buildRequest(), buildContext(encoded));
    expect(res.status).toBe(200);
  });
});

// ─── 2. Authorization header ──────────────────────────────────────────────────

describe("GET /api/tracking/[trackingNumber] — Authorization header", () => {
  it("returns 401 AUTH_REQUIRED when Authorization header is missing", async () => {
    const res = await GET(
      buildRequest({ authHeader: null }),
      buildContext(VALID_TN),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("returns 401 AUTH_REQUIRED for a non-Bearer scheme", async () => {
    const res = await GET(
      buildRequest({ authHeader: "Basic abc:def" }),
      buildContext(VALID_TN),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("returns 401 AUTH_REQUIRED when Bearer token is empty/whitespace", async () => {
    const res = await GET(
      buildRequest({ authHeader: "Bearer    " }),
      buildContext(VALID_TN),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("AUTH_REQUIRED");
  });
});

// ─── 3. Service availability ──────────────────────────────────────────────────

describe("GET /api/tracking/[trackingNumber] — service availability", () => {
  it("returns 503 SERVICE_UNAVAILABLE when NEXT_PUBLIC_CONVEX_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    expect(res.status).toBe(503);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("getConvexClient() returns null when the env var is missing", () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    expect(getConvexClient()).toBeNull();
  });

  it("getConvexClient() returns a client when the env var is set", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://test.convex.cloud";
    const client = getConvexClient();
    expect(client).not.toBeNull();
  });
});

// ─── 4. Convex error translation ──────────────────────────────────────────────

describe("translateConvexError", () => {
  it.each([
    ["[INVALID_TRACKING_NUMBER] bad input", 400, "INVALID_TRACKING_NUMBER"],
    ["[NOT_FOUND] no such number", 404, "NOT_FOUND"],
    ["[RATE_LIMITED] slow down", 429, "RATE_LIMITED"],
    ["[SERVER_ERROR] FedEx 503", 502, "SERVER_ERROR"],
    ["[NETWORK_ERROR] DNS failure", 502, "NETWORK_ERROR"],
    ["[PARSE_ERROR] bad JSON", 502, "PARSE_ERROR"],
    ["[AUTH_ERROR] token rejected", 502, "AUTH_ERROR"],
    ["[CONFIGURATION_ERROR] missing creds", 503, "CONFIGURATION_ERROR"],
    ["[UNKNOWN_ERROR] something else", 500, "UNKNOWN_ERROR"],
  ] as const)(
    "%s → HTTP %d (%s)",
    async (message, expectedStatus, expectedCode) => {
      const res = translateConvexError(new Error(message));
      expect(res.status).toBe(expectedStatus);
      const body = (await res.json()) as TrackingApiErrorBody;
      expect(body.ok).toBe(false);
      expect(body.code).toBe(expectedCode);
      expect(body.status).toBe(expectedStatus);
      // The bracket prefix should be stripped.
      expect(body.message).not.toMatch(/^\[[A-Z_]+\]/);
    },
  );

  it("[AUTH_REQUIRED] (action-level auth guard) → 401 AUTH_REQUIRED", async () => {
    const res = translateConvexError(
      new Error("[AUTH_REQUIRED] no Kinde identity"),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("plain Error without bracket prefix → 500 UNKNOWN_ERROR", async () => {
    const res = translateConvexError(new Error("something broke"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("UNKNOWN_ERROR");
    expect(body.message).toContain("something broke");
  });

  it("non-Error thrown value → 500 UNKNOWN_ERROR", async () => {
    const res = translateConvexError({ weird: "object" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("UNKNOWN_ERROR");
  });

  it("string thrown value (rare, but legal) → 500 UNKNOWN_ERROR", async () => {
    const res = translateConvexError("kapow");
    expect(res.status).toBe(500);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("UNKNOWN_ERROR");
    expect(body.message).toContain("kapow");
  });
});

// ─── 5. Response body shape & cache headers ───────────────────────────────────

describe("GET /api/tracking/[trackingNumber] — response body shape", () => {
  it("success body matches TrackingApiSuccessBody", async () => {
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackingApiResponseBody;
    expect(body.ok).toBe(true);
    if (body.ok) {
      expect(body.data.trackingNumber).toBe(VALID_TN);
      expect(body.data.status).toBe("in_transit");
      expect(body.data.statusDescription).toBe("In transit");
      expect(body.data.events).toHaveLength(1);
      expect(body.data.lastLocation).toEqual({
        city: "Memphis",
        state: "TN",
        country: "US",
      });
    }
  });

  it("error body matches TrackingApiErrorBody discriminator", async () => {
    const res = await GET(buildRequest(), buildContext(""));
    const body = (await res.json()) as TrackingApiResponseBody;
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(typeof body.code).toBe("string");
      expect(typeof body.message).toBe("string");
      expect(typeof body.status).toBe("number");
    }
  });

  it("Cache-Control: no-store on success responses", async () => {
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Pragma")).toBe("no-cache");
  });

  it("Cache-Control: no-store on error responses", async () => {
    const res = await GET(buildRequest(), buildContext(""));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ─── 6. Result reshaping ──────────────────────────────────────────────────────

describe("GET /api/tracking/[trackingNumber] — result reshaping", () => {
  it("derives lastLocation from events[0]", async () => {
    setMockAction(async () =>
      buildSuccessActionResult({
        events: [
          {
            timestamp: "2025-06-02T14:30:00Z",
            eventType: "OD",
            description: "Out for delivery",
            location: { city: "Ann Arbor", state: "MI", country: "US" },
          },
          {
            timestamp: "2025-06-01T08:00:00Z",
            eventType: "AR",
            description: "Arrived at facility",
            location: { city: "Memphis", state: "TN", country: "US" },
          },
        ],
      }),
    );
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    const body = (await res.json()) as TrackingApiSuccessBody;
    expect(body.data.lastLocation).toEqual({
      city: "Ann Arbor",
      state: "MI",
      country: "US",
    });
  });

  it("returns lastLocation: undefined when events array is empty", async () => {
    setMockAction(async () =>
      buildSuccessActionResult({ events: [] }),
    );
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    const body = (await res.json()) as TrackingApiSuccessBody;
    expect(body.data.lastLocation).toBeUndefined();
    expect(body.data.events).toEqual([]);
  });

  it("normalises missing scan fields to empty strings", async () => {
    setMockAction(async () =>
      buildSuccessActionResult({
        events: [
          {
            // timestamp / eventType / description deliberately omitted
            location: { city: "Atlanta" },
          },
        ],
      }),
    );
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    const body = (await res.json()) as TrackingApiSuccessBody;
    expect(body.data.events[0].timestamp).toBe("");
    expect(body.data.events[0].eventType).toBe("");
    expect(body.data.events[0].description).toBe("");
    expect(body.data.events[0].location.city).toBe("Atlanta");
  });

  it("defaults status to 'unknown' when Convex omits it", async () => {
    // Force the Convex result to lack a status field.
    setMockAction(async () => ({
      trackingNumber: VALID_TN,
      description: "Pre-shipment",
      events: [],
    }));
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    const body = (await res.json()) as TrackingApiSuccessBody;
    expect(body.data.status).toBe("unknown");
  });

  it("forwards the Convex error through translateConvexError on action throw", async () => {
    setMockAction(async () => {
      throw new Error("[NOT_FOUND] Tracking number was not found.");
    });
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    expect(res.status).toBe(404);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("forwards rate-limit errors as HTTP 429", async () => {
    setMockAction(async () => {
      throw new Error("[RATE_LIMITED] FedEx API rate limit exceeded.");
    });
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    expect(res.status).toBe(429);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("treats non-Error throws from Convex as 500 UNKNOWN_ERROR", async () => {
    setMockAction(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "raw string from buggy action";
    });
    const res = await GET(buildRequest(), buildContext(VALID_TN));
    expect(res.status).toBe(500);
    const body = (await res.json()) as TrackingApiErrorBody;
    expect(body.code).toBe("UNKNOWN_ERROR");
  });
});

// ─── 7. Error code matrix consistency ─────────────────────────────────────────

describe("Tracking API error code → HTTP status mapping", () => {
  it("every TrackingApiErrorCode has a status entry", () => {
    for (const code of TRACKING_API_ERROR_CODES) {
      expect(TRACKING_API_STATUS_MAP[code]).toBeTypeOf("number");
    }
  });

  it("every Convex tracking error code maps to a TrackingApiErrorCode", () => {
    for (const [convexCode, apiCode] of Object.entries(
      CONVEX_ERROR_CODE_TO_API_CODE,
    )) {
      expect(TRACKING_API_ERROR_CODES).toContain(apiCode);
      // Sanity check: the convex code is a known FedExTrackingErrorCode.
      expect(typeof convexCode).toBe("string");
    }
  });

  it("400 is reserved for INVALID_TRACKING_NUMBER", () => {
    expect(TRACKING_API_STATUS_MAP.INVALID_TRACKING_NUMBER).toBe(400);
  });

  it("401 is reserved for AUTH_REQUIRED", () => {
    expect(TRACKING_API_STATUS_MAP.AUTH_REQUIRED).toBe(401);
  });

  it("404 is reserved for NOT_FOUND", () => {
    expect(TRACKING_API_STATUS_MAP.NOT_FOUND).toBe(404);
  });

  it("429 is reserved for RATE_LIMITED", () => {
    expect(TRACKING_API_STATUS_MAP.RATE_LIMITED).toBe(429);
  });

  it("UNKNOWN_ERROR maps to 500", () => {
    expect(TRACKING_API_STATUS_MAP.UNKNOWN_ERROR).toBe(500);
  });

  it("upstream provider errors map to 502", () => {
    expect(TRACKING_API_STATUS_MAP.SERVER_ERROR).toBe(502);
    expect(TRACKING_API_STATUS_MAP.NETWORK_ERROR).toBe(502);
    expect(TRACKING_API_STATUS_MAP.PARSE_ERROR).toBe(502);
    expect(TRACKING_API_STATUS_MAP.AUTH_ERROR).toBe(502);
  });

  it("server-config errors map to 503", () => {
    expect(TRACKING_API_STATUS_MAP.CONFIGURATION_ERROR).toBe(503);
    expect(TRACKING_API_STATUS_MAP.SERVICE_UNAVAILABLE).toBe(503);
  });
});
