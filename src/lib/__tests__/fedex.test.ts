/**
 * Unit tests for the FedEx tracking client module.
 *
 * Tests are structured to exercise:
 *   • Configuration helpers
 *   • Token fetching and caching
 *   • The `trackPackage` function (happy path + error paths)
 *   • `isValidTrackingNumber` heuristic
 *   • `toConvexShipmentStatus` mapping
 *
 * All HTTP calls are intercepted via `vi.stubGlobal("fetch", …)` so tests
 * run fully offline without a real FedEx account.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Module under test ────────────────────────────────────────────────────────

// We import dynamically inside each describe block after setting env so that
// module-level constants are evaluated with the right environment.
import {
  areFedExCredentialsConfigured,
  FedExError,
  FEDEX_PRODUCTION_BASE,
  FEDEX_SANDBOX_BASE,
  getFedExBaseUrl,
  getTrackingStatus,
  invalidateTokenCache,
  isSandboxMode,
  isValidTrackingNumber,
  toConvexShipmentStatus,
  trackPackage,
} from "../fedex";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal valid FedEx Track API response. */
function makeTrackResponse(
  trackingNumber: string,
  statusCode: string,
  description: string,
  events: Array<{
    timestamp: string;
    eventType: string;
    eventDescription: string;
    city?: string;
  }> = []
) {
  return {
    output: {
      completeTrackResults: [
        {
          trackingInfo: [
            {
              trackingNumber,
              latestStatusDetail: {
                code: statusCode,
                description,
                statusByLocale: description,
              },
              scanEvents: events.map((e) => ({
                timestamp: e.timestamp,
                eventType: e.eventType,
                eventDescription: e.eventDescription,
                address: e.city ? { city: e.city } : undefined,
              })),
            },
          ],
        },
      ],
    },
  };
}

/** Build a successful OAuth token response. */
function makeTokenResponse() {
  return {
    access_token: "test-bearer-token-xyz",
    token_type:   "Bearer",
    expires_in:   3600,
  };
}

/** Create a mock fetch that handles both /oauth/token and /track/v1/... */
function mockFetch(tokenResponse: unknown, trackResponse: unknown) {
  return vi.fn(async (url: string) => {
    if (String(url).includes("/oauth/token")) {
      return {
        ok:     true,
        status: 200,
        json:   async () => tokenResponse,
        text:   async () => JSON.stringify(tokenResponse),
      };
    }
    return {
      ok:     true,
      status: 200,
      json:   async () => trackResponse,
      text:   async () => JSON.stringify(trackResponse),
    };
  }) as unknown as typeof fetch;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset env to known good defaults before each test
  process.env.FEDEX_CLIENT_ID     = "test-client-id";
  process.env.FEDEX_CLIENT_SECRET = "test-client-secret";
  delete process.env.FEDEX_API_BASE_URL;
  delete process.env.FEDEX_ACCOUNT_NUMBER;

  // Reset any stubbed fetch
  vi.unstubAllGlobals();
});

// ─── getTrackingStatus (alias) ────────────────────────────────────────────────

describe("getTrackingStatus", () => {
  it("is exported from the module", () => {
    expect(typeof getTrackingStatus).toBe("function");
  });

  it("is the same function as trackPackage", () => {
    expect(getTrackingStatus).toBe(trackPackage);
  });

  it("returns normalised tracking result on success (via alias)", async () => {
    const trackResponse = makeTrackResponse(
      "794644823741",
      "IT",
      "In transit",
      [
        {
          timestamp:        "2025-06-01T10:00:00Z",
          eventType:        "IT",
          eventDescription: "In transit",
          city:             "Memphis",
        },
      ]
    );

    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), trackResponse));

    const result = await getTrackingStatus("794644823741");

    expect(result.trackingNumber).toBe("794644823741");
    expect(result.status).toBe("in_transit");
    expect(result.description).toBe("In transit");
    expect(result.events).toHaveLength(1);
  });

  it("throws FedExError with RATE_LIMITED on 429 (via alias)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/oauth/token")) {
        return {
          ok: true, status: 200,
          json: async () => makeTokenResponse(),
          text: async () => "",
        };
      }
      return { ok: false, status: 429, json: async () => ({}), text: async () => "" };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    await expect(getTrackingStatus("794644823741")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      statusCode: 429,
    });
  });

  it("throws FedExError with NOT_FOUND for unknown tracking number (via alias)", async () => {
    const errorResponse = {
      errors: [{ code: "TRACKING.TRACKINGNUMBER.NOTFOUND", message: "Not found." }],
    };

    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), errorResponse));

    await expect(getTrackingStatus("000000000000")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ─── isValidTrackingNumber ────────────────────────────────────────────────────

describe("isValidTrackingNumber", () => {
  it("returns false for empty string", () => {
    expect(isValidTrackingNumber("")).toBe(false);
  });

  it("returns false for whitespace-only", () => {
    expect(isValidTrackingNumber("   ")).toBe(false);
  });

  it("returns false for too-short numeric string", () => {
    expect(isValidTrackingNumber("12345")).toBe(false);
  });

  it("returns false for non-numeric / non-door-tag string", () => {
    expect(isValidTrackingNumber("abc")).toBe(false);
    expect(isValidTrackingNumber("FEDEX123")).toBe(false);
  });

  it("accepts 12-digit Express/Ground numbers", () => {
    expect(isValidTrackingNumber("794644823741")).toBe(true);
  });

  it("accepts 15-digit numbers", () => {
    expect(isValidTrackingNumber("961234567890123")).toBe(true);
  });

  it("accepts 20-digit Ground numbers", () => {
    expect(isValidTrackingNumber("96123456789012345678")).toBe(true);
  });

  it("accepts door tag format (DT + digits)", () => {
    expect(isValidTrackingNumber("DT000123456789012")).toBe(true);
    expect(isValidTrackingNumber("dt000123456789012")).toBe(true); // case-insensitive
  });

  it("strips whitespace before validating", () => {
    expect(isValidTrackingNumber("  794644823741  ")).toBe(true);
  });
});

// ─── Configuration helpers ────────────────────────────────────────────────────

describe("getFedExBaseUrl", () => {
  it("returns production URL by default", () => {
    expect(getFedExBaseUrl()).toBe(FEDEX_PRODUCTION_BASE);
  });

  it("returns override URL from env", () => {
    process.env.FEDEX_API_BASE_URL = "https://apis-sandbox.fedex.com";
    expect(getFedExBaseUrl()).toBe("https://apis-sandbox.fedex.com");
  });

  it("strips trailing slash from override URL", () => {
    process.env.FEDEX_API_BASE_URL = "https://apis-sandbox.fedex.com/";
    expect(getFedExBaseUrl()).toBe("https://apis-sandbox.fedex.com");
  });
});

describe("isSandboxMode", () => {
  it("returns false when using production base", () => {
    expect(isSandboxMode()).toBe(false);
  });

  it("returns true when FEDEX_API_BASE_URL is sandbox", () => {
    process.env.FEDEX_API_BASE_URL = FEDEX_SANDBOX_BASE;
    expect(isSandboxMode()).toBe(true);
  });
});

describe("areFedExCredentialsConfigured", () => {
  it("returns true when both vars are set", () => {
    process.env.FEDEX_CLIENT_ID     = "abc";
    process.env.FEDEX_CLIENT_SECRET = "xyz";
    expect(areFedExCredentialsConfigured()).toBe(true);
  });

  it("returns false when client ID is missing", () => {
    delete process.env.FEDEX_CLIENT_ID;
    expect(areFedExCredentialsConfigured()).toBe(false);
  });

  it("returns false when client secret is missing", () => {
    delete process.env.FEDEX_CLIENT_SECRET;
    expect(areFedExCredentialsConfigured()).toBe(false);
  });

  it("returns false when both are missing", () => {
    delete process.env.FEDEX_CLIENT_ID;
    delete process.env.FEDEX_CLIENT_SECRET;
    expect(areFedExCredentialsConfigured()).toBe(false);
  });
});

// ─── toConvexShipmentStatus ───────────────────────────────────────────────────

describe("toConvexShipmentStatus", () => {
  it("maps all known statuses correctly", () => {
    expect(toConvexShipmentStatus("label_created")).toBe("label_created");
    expect(toConvexShipmentStatus("picked_up")).toBe("picked_up");
    expect(toConvexShipmentStatus("in_transit")).toBe("in_transit");
    expect(toConvexShipmentStatus("out_for_delivery")).toBe("out_for_delivery");
    expect(toConvexShipmentStatus("delivered")).toBe("delivered");
    expect(toConvexShipmentStatus("exception")).toBe("exception");
  });

  it("maps unknown to in_transit as fallback", () => {
    expect(toConvexShipmentStatus("unknown")).toBe("in_transit");
  });
});

// ─── FedExError ───────────────────────────────────────────────────────────────

describe("FedExError", () => {
  it("is an instance of Error", () => {
    const err = new FedExError("AUTH_ERROR", "test message");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FedExError);
  });

  it("sets name to FedExError", () => {
    const err = new FedExError("AUTH_ERROR", "msg");
    expect(err.name).toBe("FedExError");
  });

  it("exposes code, message, statusCode, and raw", () => {
    const raw = { detail: "oops" };
    const err = new FedExError("NOT_FOUND", "not found", {
      statusCode: 404,
      raw,
    });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("not found");
    expect(err.statusCode).toBe(404);
    expect(err.raw).toStrictEqual(raw);
  });
});

// ─── trackPackage ─────────────────────────────────────────────────────────────

describe("trackPackage", () => {
  it("throws FedExError when trackingNumber is empty", async () => {
    await expect(trackPackage("")).rejects.toBeInstanceOf(FedExError);
    await expect(trackPackage("   ")).rejects.toMatchObject({
      code: "UNKNOWN_ERROR",
    });
  });

  it("throws CONFIGURATION_ERROR when credentials are missing", async () => {
    invalidateTokenCache();
    delete process.env.FEDEX_CLIENT_ID;
    delete process.env.FEDEX_CLIENT_SECRET;

    await expect(trackPackage("794644823741")).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
    });
  });

  it("returns normalised tracking result on success", async () => {
    const trackResponse = makeTrackResponse(
      "794644823741",
      "IT",
      "In transit",
      [
        {
          timestamp: "2025-06-01T10:00:00Z",
          eventType: "IT",
          eventDescription: "In transit",
          city: "Memphis",
        },
      ]
    );

    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), trackResponse));

    const result = await trackPackage("794644823741");

    expect(result.trackingNumber).toBe("794644823741");
    expect(result.status).toBe("in_transit");
    expect(result.description).toBe("In transit");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      timestamp:   "2025-06-01T10:00:00Z",
      eventType:   "IT",
      description: "In transit",
      location:    { city: "Memphis" },
    });
  });

  it("maps FedEx DL code to delivered status", async () => {
    const trackResponse = makeTrackResponse("794644823741", "DL", "Delivered");
    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), trackResponse));

    const result = await trackPackage("794644823741");
    expect(result.status).toBe("delivered");
  });

  it("maps FedEx OD code to out_for_delivery status", async () => {
    const trackResponse = makeTrackResponse("794644823741", "OD", "Out for delivery");
    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), trackResponse));

    const result = await trackPackage("794644823741");
    expect(result.status).toBe("out_for_delivery");
  });

  it("maps FedEx OC code to label_created status", async () => {
    const trackResponse = makeTrackResponse("794644823741", "OC", "Label created");
    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), trackResponse));

    const result = await trackPackage("794644823741");
    expect(result.status).toBe("label_created");
  });

  it("maps FedEx PU code to picked_up status", async () => {
    const trackResponse = makeTrackResponse("794644823741", "PU", "Picked up");
    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), trackResponse));

    const result = await trackPackage("794644823741");
    expect(result.status).toBe("picked_up");
  });

  it("maps FedEx SE code to exception status", async () => {
    const trackResponse = makeTrackResponse("794644823741", "SE", "Service exception");
    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), trackResponse));

    const result = await trackPackage("794644823741");
    expect(result.status).toBe("exception");
  });

  it("throws NOT_FOUND on FedEx API error TRACKING.TRACKINGNUMBER.NOTFOUND", async () => {
    const errorResponse = {
      errors: [
        {
          code:    "TRACKING.TRACKINGNUMBER.NOTFOUND",
          message: "Tracking number cannot be found.",
        },
      ],
    };

    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), errorResponse));

    await expect(trackPackage("000000000000")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND when response has no track results", async () => {
    const emptyResponse = {
      output: { completeTrackResults: [] },
    };

    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), emptyResponse));

    await expect(trackPackage("794644823741")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws RATE_LIMITED on 429 response from track endpoint", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/oauth/token")) {
        return {
          ok:   true,
          status: 200,
          json: async () => makeTokenResponse(),
          text: async () => "",
        };
      }
      return {
        ok:     false,
        status: 429,
        json:   async () => ({}),
        text:   async () => "rate limited",
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    await expect(trackPackage("794644823741")).rejects.toMatchObject({
      code:       "RATE_LIMITED",
      statusCode: 429,
    });
  });

  it("throws SERVER_ERROR on 500 response from track endpoint", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/oauth/token")) {
        return {
          ok:     true,
          status: 200,
          json:   async () => makeTokenResponse(),
          text:   async () => "",
        };
      }
      return {
        ok:     false,
        status: 500,
        json:   async () => ({}),
        text:   async () => "internal server error",
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    await expect(trackPackage("794644823741")).rejects.toMatchObject({
      code:       "SERVER_ERROR",
      statusCode: 500,
    });
  });

  it("throws NETWORK_ERROR when fetch rejects entirely", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/oauth/token")) {
        return {
          ok:     true,
          status: 200,
          json:   async () => makeTokenResponse(),
          text:   async () => "",
        };
      }
      throw new TypeError("Network error: failed to fetch");
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    await expect(trackPackage("794644823741")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("throws AUTH_ERROR when OAuth token endpoint returns non-200", async () => {
    const fetchMock = vi.fn(async () => ({
      ok:     false,
      status: 401,
      json:   async () => ({}),
      text:   async () => "unauthorized",
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    await expect(trackPackage("794644823741")).rejects.toMatchObject({
      code:       "AUTH_ERROR",
      statusCode: 401,
    });
  });

  it("strips leading/trailing whitespace from tracking number", async () => {
    const trackResponse = makeTrackResponse("794644823741", "IT", "In transit");
    const fetchMock = mockFetch(makeTokenResponse(), trackResponse);
    vi.stubGlobal("fetch", fetchMock);

    // Should not throw; whitespace is stripped
    const result = await trackPackage("  794644823741  ");
    expect(result.trackingNumber).toBe("794644823741");
  });

  it("includes estimatedDelivery when available in response", async () => {
    const trackResponse = {
      output: {
        completeTrackResults: [
          {
            trackingInfo: [
              {
                trackingNumber: "794644823741",
                latestStatusDetail: { code: "IT", statusByLocale: "In transit" },
                estimatedDeliveryTimeWindow: {
                  window: { ends: "2025-06-03T20:00:00Z" },
                },
                scanEvents: [],
              },
            ],
          },
        ],
      },
    };

    vi.stubGlobal("fetch", mockFetch(makeTokenResponse(), trackResponse));

    const result = await trackPackage("794644823741");
    expect(result.estimatedDelivery).toBe("2025-06-03T20:00:00Z");
  });
});
