/**
 * @vitest-environment node
 *
 * Unit tests — fetchTracking client wrapper for GET /api/tracking/[trackingNumber].
 *
 * AC 380003 / Sub-AC 3: Implement read-only tracking endpoint integration with
 * request/response typing and error handling.
 *
 * Coverage:
 *   1. URL construction (encodes the tracking number)
 *   2. Authorization header forwarding
 *   3. Successful response unwraps `{ ok: true, data }` → TrackingApiResult
 *   4. Error response → typed TrackingApiError with code/status
 *   5. Network failures → TrackingApiError("NETWORK_ERROR")
 *   6. Non-JSON response → TrackingApiError("PARSE_ERROR")
 *   7. Aborted request → TrackingApiError("UNKNOWN_ERROR")
 *   8. Missing fetch implementation → TrackingApiError("UNKNOWN_ERROR")
 *   9. baseUrl handling
 */

import { describe, it, expect, vi } from "vitest";

import {
  fetchTracking,
  TrackingApiError,
} from "@/lib/tracking-client";
import type {
  TrackingApiErrorBody,
  TrackingApiResult,
  TrackingApiSuccessBody,
} from "@/types/tracking-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TN = "794644823741";

function buildSuccessResult(): TrackingApiResult {
  return {
    trackingNumber: VALID_TN,
    status: "in_transit",
    statusCode: "IT",
    statusDescription: "In transit",
    estimatedDelivery: "2025-06-03T20:00:00Z",
    lastLocation: { city: "Memphis", state: "TN", country: "US" },
    events: [
      {
        timestamp: "2025-06-02T14:30:00Z",
        eventType: "AR",
        description: "Arrived at FedEx location",
        location: { city: "Memphis", state: "TN", country: "US" },
      },
    ],
  };
}

function jsonResponse(
  body: unknown,
  init: { status?: number } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Helper: typed mock fetch that satisfies the (input, init?) signature.
type FetchArgs = Parameters<typeof fetch>;
function makeFetchMock(impl: () => Promise<Response>) {
  return vi.fn<(...args: FetchArgs) => Promise<Response>>(
    async (..._args: FetchArgs) => impl(),
  );
}

// ─── 1. URL construction ──────────────────────────────────────────────────────

describe("fetchTracking — URL construction", () => {
  it("encodes the tracking number into the URL path", async () => {
    const fetchImpl = makeFetchMock(async () =>
      jsonResponse({ ok: true, data: buildSuccessResult() } as TrackingApiSuccessBody),
    );
    await fetchTracking(VALID_TN, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0]![0];
    expect(url).toBe(`/api/tracking/${VALID_TN}`);
  });

  it("URL-encodes tracking numbers with reserved characters", async () => {
    const tricky = "DT 000123456789012";
    const fetchImpl = makeFetchMock(async () =>
      jsonResponse({
        ok: true,
        data: { ...buildSuccessResult(), trackingNumber: tricky },
      }),
    );
    await fetchTracking(tricky, { fetchImpl });
    const url = fetchImpl.mock.calls[0]![0];
    expect(url).toBe(`/api/tracking/${encodeURIComponent(tricky)}`);
  });

  it("strips trailing slashes from baseUrl", async () => {
    const fetchImpl = makeFetchMock(async () =>
      jsonResponse({ ok: true, data: buildSuccessResult() }),
    );
    await fetchTracking(VALID_TN, {
      fetchImpl,
      baseUrl: "https://app.example.com/",
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      `https://app.example.com/api/tracking/${VALID_TN}`,
    );
  });
});

// ─── 2. Authorization header ─────────────────────────────────────────────────

describe("fetchTracking — Authorization", () => {
  it("forwards the access token as a Bearer header", async () => {
    const fetchImpl = makeFetchMock(async () =>
      jsonResponse({ ok: true, data: buildSuccessResult() }),
    );
    await fetchTracking(VALID_TN, {
      fetchImpl,
      accessToken: "test-kinde-token",
    });
    const init = fetchImpl.mock.calls[0]![1];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-kinde-token",
    });
  });

  it("omits the Authorization header when no token is provided", async () => {
    const fetchImpl = makeFetchMock(async () =>
      jsonResponse({ ok: true, data: buildSuccessResult() }),
    );
    await fetchTracking(VALID_TN, { fetchImpl });
    const init = fetchImpl.mock.calls[0]![1];
    expect(
      (init?.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });
});

// ─── 3. Successful response ──────────────────────────────────────────────────

describe("fetchTracking — successful response", () => {
  it("unwraps the success envelope into a TrackingApiResult", async () => {
    const expected = buildSuccessResult();
    const fetchImpl = makeFetchMock(async () =>
      jsonResponse({ ok: true, data: expected }),
    );
    const result = await fetchTracking(VALID_TN, { fetchImpl });
    expect(result).toEqual(expected);
  });

  it("requests no-store cache mode", async () => {
    const fetchImpl = makeFetchMock(async () =>
      jsonResponse({ ok: true, data: buildSuccessResult() }),
    );
    await fetchTracking(VALID_TN, { fetchImpl });
    const init = fetchImpl.mock.calls[0]![1];
    expect(init?.cache).toBe("no-store");
  });
});

// ─── 4. Error response ───────────────────────────────────────────────────────

describe("fetchTracking — error response translation", () => {
  it("throws TrackingApiError with code from the body", async () => {
    const errBody: TrackingApiErrorBody = {
      ok: false,
      code: "NOT_FOUND",
      message: "Tracking number was not found.",
      status: 404,
    };
    const fetchImpl = makeFetchMock(async () => jsonResponse(errBody, { status: 404 }));

    await expect(fetchTracking(VALID_TN, { fetchImpl })).rejects.toThrow(
      TrackingApiError,
    );

    try {
      await fetchTracking(VALID_TN, { fetchImpl });
    } catch (err) {
      expect(err).toBeInstanceOf(TrackingApiError);
      const e = err as TrackingApiError;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.status).toBe(404);
      expect(e.message).toBe("Tracking number was not found.");
    }
  });

  it("propagates rate-limit errors as TrackingApiError", async () => {
    const errBody: TrackingApiErrorBody = {
      ok: false,
      code: "RATE_LIMITED",
      message: "Too many requests.",
      status: 429,
    };
    const fetchImpl = makeFetchMock(async () => jsonResponse(errBody, { status: 429 }));
    await expect(fetchTracking(VALID_TN, { fetchImpl })).rejects.toMatchObject(
      { code: "RATE_LIMITED", status: 429 },
    );
  });

  it("propagates auth-required errors as TrackingApiError(AUTH_REQUIRED)", async () => {
    const errBody: TrackingApiErrorBody = {
      ok: false,
      code: "AUTH_REQUIRED",
      message: "Authentication required.",
      status: 401,
    };
    const fetchImpl = makeFetchMock(async () => jsonResponse(errBody, { status: 401 }));
    await expect(fetchTracking(VALID_TN, { fetchImpl })).rejects.toMatchObject(
      { code: "AUTH_REQUIRED", status: 401 },
    );
  });
});

// ─── 5. Network failure ──────────────────────────────────────────────────────

describe("fetchTracking — network failure", () => {
  it("throws TrackingApiError(NETWORK_ERROR) when fetch rejects", async () => {
    const fetchImpl = makeFetchMock(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchTracking(VALID_TN, { fetchImpl })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 502,
    });
  });
});

// ─── 6. Malformed response ───────────────────────────────────────────────────

describe("fetchTracking — malformed response", () => {
  it("throws TrackingApiError(PARSE_ERROR) when body is not JSON", async () => {
    const fetchImpl = makeFetchMock(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    );
    await expect(fetchTracking(VALID_TN, { fetchImpl })).rejects.toMatchObject({
      code: "PARSE_ERROR",
    });
  });

  it("throws TrackingApiError(PARSE_ERROR) when body shape is unexpected", async () => {
    const fetchImpl = makeFetchMock(async () => jsonResponse({ unexpected: true }));
    await expect(fetchTracking(VALID_TN, { fetchImpl })).rejects.toMatchObject({
      code: "PARSE_ERROR",
    });
  });
});

// ─── 7. Aborted request ──────────────────────────────────────────────────────

describe("fetchTracking — abort handling", () => {
  it("translates AbortError into TrackingApiError(UNKNOWN_ERROR)", async () => {
    const fetchImpl = makeFetchMock(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(fetchTracking(VALID_TN, { fetchImpl })).rejects.toMatchObject({
      code: "UNKNOWN_ERROR",
      message: expect.stringMatching(/abort/i),
    });
  });
});

// ─── 8. Missing fetch ────────────────────────────────────────────────────────

describe("fetchTracking — fetch unavailable", () => {
  it("throws TrackingApiError(UNKNOWN_ERROR) when fetch is not a function", async () => {
    const original = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = undefined;
    try {
      await expect(fetchTracking(VALID_TN, {})).rejects.toMatchObject({
        code: "UNKNOWN_ERROR",
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});
