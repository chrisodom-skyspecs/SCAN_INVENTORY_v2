/**
 * Unit tests for src/services/fedex.ts
 *
 * Sub-AC 1: Configure FedEx Track API credentials and create a typed HTTP
 * client wrapper (env vars, auth headers, base URL) in a shared services module.
 *
 * Tests cover:
 *   1. getFedExConfig()          — env var validation, base URL resolution
 *   2. FedExConfigError          — structure, missing vars list, message
 *   3. isFedExConfigured()       — boolean check without throwing
 *   4. FedExHttpClient           — constructor, buildAuthHeaders, buildOAuthHeaders,
 *                                  buildOAuthBody, buildUrl, invalidateToken
 *   5. createFedExClient()       — factory reads env vars, returns FedExHttpClient
 *   6. Re-exports                — key symbols from lib/fedex and
 *                                  lib/fedex-tracking-errors are re-exported
 *
 * Environment isolation:
 *   Each test that manipulates process.env resets it in an afterEach block
 *   to avoid cross-test contamination.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  // Config
  getFedExConfig,
  isFedExConfigured,
  FedExConfigError,
  FedExClientConfig,

  // HTTP client
  FedExHttpClient,
  createFedExClient,

  // Constants
  FEDEX_PRODUCTION_BASE_URL,
  FEDEX_SANDBOX_BASE_URL,

  // Re-exported from lib/fedex
  FedExError,
  isValidTrackingNumber,
  toConvexShipmentStatus,
  parseFedExErrorCode,
  getFedExUserErrorMessage,
  isFedExTransientError,
  FEDEX_ERROR_MESSAGES,
  FEDEX_TRACKING_ERROR_CODES,
} from "../fedex";

// ─── Env helpers ──────────────────────────────────────────────────────────────

const REQUIRED_ENV: Record<string, string> = {
  FEDEX_CLIENT_ID:     "test-client-id",
  FEDEX_CLIENT_SECRET: "test-client-secret",
};

function setEnv(overrides: Record<string, string | undefined> = {}): void {
  for (const [k, v] of Object.entries({ ...REQUIRED_ENV, ...overrides })) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function clearFedExEnv(): void {
  delete process.env.FEDEX_CLIENT_ID;
  delete process.env.FEDEX_CLIENT_SECRET;
  delete process.env.FEDEX_API_BASE_URL;
  delete process.env.FEDEX_ACCOUNT_NUMBER;
}

// ─── FEDEX_PRODUCTION_BASE_URL / FEDEX_SANDBOX_BASE_URL ──────────────────────

describe("FedEx base URL constants", () => {
  it("FEDEX_PRODUCTION_BASE_URL is the FedEx production API", () => {
    expect(FEDEX_PRODUCTION_BASE_URL).toBe("https://apis.fedex.com");
  });

  it("FEDEX_SANDBOX_BASE_URL is the FedEx sandbox API", () => {
    expect(FEDEX_SANDBOX_BASE_URL).toBe("https://apis-sandbox.fedex.com");
  });

  it("production and sandbox URLs are distinct strings", () => {
    expect(FEDEX_PRODUCTION_BASE_URL).not.toBe(FEDEX_SANDBOX_BASE_URL);
  });
});

// ─── FedExConfigError ─────────────────────────────────────────────────────────

describe("FedExConfigError", () => {
  it("is an instance of Error", () => {
    const err = new FedExConfigError(["FEDEX_CLIENT_ID"]);
    expect(err).toBeInstanceOf(Error);
  });

  it("has name 'FedExConfigError'", () => {
    const err = new FedExConfigError(["FEDEX_CLIENT_ID"]);
    expect(err.name).toBe("FedExConfigError");
  });

  it("exposes the missing var names on missingVars", () => {
    const err = new FedExConfigError(["FEDEX_CLIENT_ID", "FEDEX_CLIENT_SECRET"]);
    expect(err.missingVars).toEqual(["FEDEX_CLIENT_ID", "FEDEX_CLIENT_SECRET"]);
  });

  it("includes missing var names in the error message", () => {
    const err = new FedExConfigError(["FEDEX_CLIENT_ID"]);
    expect(err.message).toContain("FEDEX_CLIENT_ID");
  });

  it("mentions .env.local.example in the error message", () => {
    const err = new FedExConfigError(["FEDEX_CLIENT_SECRET"]);
    expect(err.message).toContain(".env.local.example");
  });
});

// ─── getFedExConfig ───────────────────────────────────────────────────────────

describe("getFedExConfig", () => {
  afterEach(clearFedExEnv);

  it("throws FedExConfigError when FEDEX_CLIENT_ID is missing", () => {
    setEnv({ FEDEX_CLIENT_ID: undefined });
    expect(() => getFedExConfig()).toThrow(FedExConfigError);
  });

  it("throws FedExConfigError when FEDEX_CLIENT_SECRET is missing", () => {
    setEnv({ FEDEX_CLIENT_SECRET: undefined });
    expect(() => getFedExConfig()).toThrow(FedExConfigError);
  });

  it("throws FedExConfigError when FEDEX_CLIENT_ID is empty string", () => {
    setEnv({ FEDEX_CLIENT_ID: "" });
    expect(() => getFedExConfig()).toThrow(FedExConfigError);
  });

  it("throws FedExConfigError when FEDEX_CLIENT_ID is whitespace-only", () => {
    setEnv({ FEDEX_CLIENT_ID: "   " });
    expect(() => getFedExConfig()).toThrow(FedExConfigError);
  });

  it("throws FedExConfigError when both required vars are missing", () => {
    setEnv({ FEDEX_CLIENT_ID: undefined, FEDEX_CLIENT_SECRET: undefined });
    try {
      getFedExConfig();
      expect.fail("expected FedExConfigError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FedExConfigError);
      const configErr = err as FedExConfigError;
      expect(configErr.missingVars).toContain("FEDEX_CLIENT_ID");
      expect(configErr.missingVars).toContain("FEDEX_CLIENT_SECRET");
    }
  });

  it("returns config with clientId and clientSecret from env vars", () => {
    setEnv();
    const config = getFedExConfig();
    expect(config.clientId).toBe("test-client-id");
    expect(config.clientSecret).toBe("test-client-secret");
  });

  it("trims whitespace from clientId and clientSecret", () => {
    setEnv({
      FEDEX_CLIENT_ID:     "  padded-id  ",
      FEDEX_CLIENT_SECRET: "  padded-secret  ",
    });
    const config = getFedExConfig();
    expect(config.clientId).toBe("padded-id");
    expect(config.clientSecret).toBe("padded-secret");
  });

  it("defaults to production base URL when FEDEX_API_BASE_URL is unset", () => {
    setEnv({ FEDEX_API_BASE_URL: undefined });
    const config = getFedExConfig();
    expect(config.baseUrl).toBe(FEDEX_PRODUCTION_BASE_URL);
    expect(config.isSandbox).toBe(false);
  });

  it("uses FEDEX_API_BASE_URL override when set", () => {
    setEnv({ FEDEX_API_BASE_URL: "https://apis-sandbox.fedex.com" });
    const config = getFedExConfig();
    expect(config.baseUrl).toBe(FEDEX_SANDBOX_BASE_URL);
  });

  it("strips trailing slash from FEDEX_API_BASE_URL", () => {
    setEnv({ FEDEX_API_BASE_URL: "https://apis-sandbox.fedex.com/" });
    const config = getFedExConfig();
    expect(config.baseUrl).toBe("https://apis-sandbox.fedex.com");
  });

  it("isSandbox is true when baseUrl matches sandbox URL", () => {
    setEnv({ FEDEX_API_BASE_URL: FEDEX_SANDBOX_BASE_URL });
    const config = getFedExConfig();
    expect(config.isSandbox).toBe(true);
  });

  it("isSandbox is false when using production URL", () => {
    setEnv({ FEDEX_API_BASE_URL: undefined });
    const config = getFedExConfig();
    expect(config.isSandbox).toBe(false);
  });

  it("accountNumber is undefined when FEDEX_ACCOUNT_NUMBER is unset", () => {
    setEnv({ FEDEX_ACCOUNT_NUMBER: undefined });
    const config = getFedExConfig();
    expect(config.accountNumber).toBeUndefined();
  });

  it("accountNumber is populated from FEDEX_ACCOUNT_NUMBER when set", () => {
    setEnv({ FEDEX_ACCOUNT_NUMBER: "123456789" });
    const config = getFedExConfig();
    expect(config.accountNumber).toBe("123456789");
  });

  it("returns a FedExClientConfig object with the correct shape", () => {
    setEnv({ FEDEX_ACCOUNT_NUMBER: "ACC-001" });
    const config = getFedExConfig();

    // Verify shape
    expect(typeof config.clientId).toBe("string");
    expect(typeof config.clientSecret).toBe("string");
    expect(typeof config.baseUrl).toBe("string");
    expect(typeof config.isSandbox).toBe("boolean");
    // accountNumber is optional but should be defined when env var is set
    expect(config.accountNumber).toBe("ACC-001");
  });
});

// ─── isFedExConfigured ────────────────────────────────────────────────────────

describe("isFedExConfigured", () => {
  afterEach(clearFedExEnv);

  it("returns true when both required env vars are set", () => {
    setEnv();
    expect(isFedExConfigured()).toBe(true);
  });

  it("returns false when FEDEX_CLIENT_ID is missing", () => {
    setEnv({ FEDEX_CLIENT_ID: undefined });
    expect(isFedExConfigured()).toBe(false);
  });

  it("returns false when FEDEX_CLIENT_SECRET is missing", () => {
    setEnv({ FEDEX_CLIENT_SECRET: undefined });
    expect(isFedExConfigured()).toBe(false);
  });

  it("returns false when FEDEX_CLIENT_ID is empty string", () => {
    setEnv({ FEDEX_CLIENT_ID: "" });
    expect(isFedExConfigured()).toBe(false);
  });

  it("returns false when both required vars are missing", () => {
    clearFedExEnv();
    expect(isFedExConfigured()).toBe(false);
  });

  it("does not throw when credentials are missing (unlike getFedExConfig)", () => {
    clearFedExEnv();
    expect(() => isFedExConfigured()).not.toThrow();
  });
});

// ─── FedExHttpClient ──────────────────────────────────────────────────────────

describe("FedExHttpClient", () => {
  const makeConfig = (overrides: Partial<FedExClientConfig> = {}): FedExClientConfig => ({
    clientId:     "my-client-id",
    clientSecret: "my-client-secret",
    baseUrl:      FEDEX_PRODUCTION_BASE_URL,
    isSandbox:    false,
    ...overrides,
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("exposes baseUrl from config", () => {
      const client = new FedExHttpClient(makeConfig({ baseUrl: FEDEX_SANDBOX_BASE_URL }));
      expect(client.baseUrl).toBe(FEDEX_SANDBOX_BASE_URL);
    });

    it("exposes isSandbox from config", () => {
      const client = new FedExHttpClient(makeConfig({ isSandbox: true }));
      expect(client.isSandbox).toBe(true);
    });

    it("exposes accountNumber from config", () => {
      const client = new FedExHttpClient(makeConfig({ accountNumber: "ACC-999" }));
      expect(client.accountNumber).toBe("ACC-999");
    });

    it("accountNumber is undefined when not in config", () => {
      const client = new FedExHttpClient(makeConfig({ accountNumber: undefined }));
      expect(client.accountNumber).toBeUndefined();
    });

    it("is an instance of FedExHttpClient", () => {
      const client = new FedExHttpClient(makeConfig());
      expect(client).toBeInstanceOf(FedExHttpClient);
    });
  });

  // ── buildUrl ───────────────────────────────────────────────────────────────

  describe("buildUrl", () => {
    it("concatenates baseUrl and path for production", () => {
      const client = new FedExHttpClient(makeConfig());
      expect(client.buildUrl("/track/v1/trackingnumbers")).toBe(
        "https://apis.fedex.com/track/v1/trackingnumbers"
      );
    });

    it("concatenates baseUrl and path for sandbox", () => {
      const client = new FedExHttpClient(
        makeConfig({ baseUrl: FEDEX_SANDBOX_BASE_URL, isSandbox: true })
      );
      expect(client.buildUrl("/oauth/token")).toBe(
        "https://apis-sandbox.fedex.com/oauth/token"
      );
    });

    it("does not add an extra slash when path starts with /", () => {
      const client = new FedExHttpClient(makeConfig());
      const url = client.buildUrl("/some/path");
      expect(url).not.toContain("//some/path");
      expect(url).toBe("https://apis.fedex.com/some/path");
    });
  });

  // ── buildAuthHeaders ───────────────────────────────────────────────────────

  describe("buildAuthHeaders", () => {
    it("includes Authorization header with Bearer prefix", () => {
      const client  = new FedExHttpClient(makeConfig());
      const headers = client.buildAuthHeaders("my-token-xyz");
      expect(headers["Authorization"]).toBe("Bearer my-token-xyz");
    });

    it("includes Content-Type application/json", () => {
      const client  = new FedExHttpClient(makeConfig());
      const headers = client.buildAuthHeaders("tok");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("includes Accept application/json", () => {
      const client  = new FedExHttpClient(makeConfig());
      const headers = client.buildAuthHeaders("tok");
      expect(headers["Accept"]).toBe("application/json");
    });

    it("includes X-locale en_US", () => {
      const client  = new FedExHttpClient(makeConfig());
      const headers = client.buildAuthHeaders("tok");
      expect(headers["X-locale"]).toBe("en_US");
    });

    it("includes x-customer-transaction-id when accountNumber is set", () => {
      const client  = new FedExHttpClient(makeConfig({ accountNumber: "ACC-007" }));
      const headers = client.buildAuthHeaders("tok");
      expect(headers["x-customer-transaction-id"]).toBe("ACC-007");
    });

    it("omits x-customer-transaction-id when accountNumber is undefined", () => {
      const client  = new FedExHttpClient(makeConfig({ accountNumber: undefined }));
      const headers = client.buildAuthHeaders("tok");
      expect("x-customer-transaction-id" in headers).toBe(false);
    });

    it("returns a plain Record<string, string> (no special types)", () => {
      const client  = new FedExHttpClient(makeConfig());
      const headers = client.buildAuthHeaders("tok");
      expect(typeof headers).toBe("object");
      for (const [, v] of Object.entries(headers)) {
        expect(typeof v).toBe("string");
      }
    });
  });

  // ── buildOAuthHeaders ──────────────────────────────────────────────────────

  describe("buildOAuthHeaders", () => {
    it("has Content-Type application/x-www-form-urlencoded", () => {
      const client  = new FedExHttpClient(makeConfig());
      const headers = client.buildOAuthHeaders();
      expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    });

    it("has Accept application/json", () => {
      const client  = new FedExHttpClient(makeConfig());
      const headers = client.buildOAuthHeaders();
      expect(headers["Accept"]).toBe("application/json");
    });
  });

  // ── buildOAuthBody ─────────────────────────────────────────────────────────

  describe("buildOAuthBody", () => {
    it("includes grant_type=client_credentials", () => {
      const client = new FedExHttpClient(makeConfig());
      const body   = client.buildOAuthBody();
      expect(body).toContain("grant_type=client_credentials");
    });

    it("includes client_id from config", () => {
      const client = new FedExHttpClient(makeConfig({ clientId: "test-cid" }));
      const body   = client.buildOAuthBody();
      expect(body).toContain("client_id=test-cid");
    });

    it("includes client_secret from config", () => {
      const client = new FedExHttpClient(makeConfig({ clientSecret: "test-csec" }));
      const body   = client.buildOAuthBody();
      expect(body).toContain("client_secret=test-csec");
    });

    it("produces URL-encoded form data (no JSON)", () => {
      const client = new FedExHttpClient(makeConfig());
      const body   = client.buildOAuthBody();
      // URL-encoded form data uses = and & (not JSON braces)
      expect(body).not.toContain("{");
      expect(body).toContain("=");
    });
  });

  // ── invalidateToken ────────────────────────────────────────────────────────

  describe("invalidateToken", () => {
    it("does not throw when cache is already empty", () => {
      const client = new FedExHttpClient(makeConfig());
      expect(() => client.invalidateToken()).not.toThrow();
    });

    it("can be called multiple times without error", () => {
      const client = new FedExHttpClient(makeConfig());
      expect(() => {
        client.invalidateToken();
        client.invalidateToken();
        client.invalidateToken();
      }).not.toThrow();
    });
  });
});

// ─── createFedExClient ────────────────────────────────────────────────────────

describe("createFedExClient", () => {
  afterEach(clearFedExEnv);

  it("returns a FedExHttpClient when env vars are set", () => {
    setEnv();
    const client = createFedExClient();
    expect(client).toBeInstanceOf(FedExHttpClient);
  });

  it("throws FedExConfigError when required env vars are missing", () => {
    clearFedExEnv();
    expect(() => createFedExClient()).toThrow(FedExConfigError);
  });

  it("client.baseUrl is the production URL by default", () => {
    setEnv({ FEDEX_API_BASE_URL: undefined });
    const client = createFedExClient();
    expect(client.baseUrl).toBe(FEDEX_PRODUCTION_BASE_URL);
  });

  it("client.baseUrl is the sandbox URL when FEDEX_API_BASE_URL is sandbox", () => {
    setEnv({ FEDEX_API_BASE_URL: FEDEX_SANDBOX_BASE_URL });
    const client = createFedExClient();
    expect(client.baseUrl).toBe(FEDEX_SANDBOX_BASE_URL);
    expect(client.isSandbox).toBe(true);
  });

  it("client.accountNumber is set when FEDEX_ACCOUNT_NUMBER is in env", () => {
    setEnv({ FEDEX_ACCOUNT_NUMBER: "MY-ACC-123" });
    const client = createFedExClient();
    expect(client.accountNumber).toBe("MY-ACC-123");
  });

  it("client.accountNumber is undefined when FEDEX_ACCOUNT_NUMBER is not in env", () => {
    setEnv({ FEDEX_ACCOUNT_NUMBER: undefined });
    const client = createFedExClient();
    expect(client.accountNumber).toBeUndefined();
  });

  it("client builds correct auth headers", () => {
    setEnv();
    const client  = createFedExClient();
    const headers = client.buildAuthHeaders("test-bearer-token");
    expect(headers["Authorization"]).toBe("Bearer test-bearer-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-locale"]).toBe("en_US");
  });

  it("client builds correct tracking URL", () => {
    setEnv();
    const client = createFedExClient();
    expect(client.buildUrl("/track/v1/trackingnumbers")).toBe(
      `${FEDEX_PRODUCTION_BASE_URL}/track/v1/trackingnumbers`
    );
  });
});

// ─── Re-exports from lib/fedex ────────────────────────────────────────────────

describe("Re-exports from @/lib/fedex", () => {
  it("FedExError is re-exported and constructable", () => {
    const err = new FedExError("AUTH_ERROR", "test error");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.name).toBe("FedExError");
  });

  it("isValidTrackingNumber is re-exported and works", () => {
    expect(isValidTrackingNumber("794644823741")).toBe(true);
    expect(isValidTrackingNumber("abc")).toBe(false);
    expect(isValidTrackingNumber("")).toBe(false);
  });

  it("toConvexShipmentStatus is re-exported and maps unknown→in_transit", () => {
    expect(toConvexShipmentStatus("unknown")).toBe("in_transit");
    expect(toConvexShipmentStatus("delivered")).toBe("delivered");
    expect(toConvexShipmentStatus("exception")).toBe("exception");
  });
});

// ─── Re-exports from lib/fedex-tracking-errors ───────────────────────────────

describe("Re-exports from @/lib/fedex-tracking-errors", () => {
  it("FEDEX_TRACKING_ERROR_CODES is re-exported with 9 codes", () => {
    expect(FEDEX_TRACKING_ERROR_CODES).toHaveLength(9);
    expect(FEDEX_TRACKING_ERROR_CODES).toContain("NOT_FOUND");
    expect(FEDEX_TRACKING_ERROR_CODES).toContain("AUTH_ERROR");
    expect(FEDEX_TRACKING_ERROR_CODES).toContain("RATE_LIMITED");
  });

  it("FEDEX_ERROR_MESSAGES is re-exported with entries for all codes", () => {
    for (const code of FEDEX_TRACKING_ERROR_CODES) {
      expect(FEDEX_ERROR_MESSAGES[code]).toBeDefined();
      expect(typeof FEDEX_ERROR_MESSAGES[code]).toBe("string");
    }
  });

  it("parseFedExErrorCode is re-exported and parses bracketed codes", () => {
    expect(parseFedExErrorCode("[NOT_FOUND] some message")).toBe("NOT_FOUND");
    expect(parseFedExErrorCode("no bracket")).toBeNull();
    expect(parseFedExErrorCode("[BOGUS_CODE] ...")).toBeNull();
  });

  it("getFedExUserErrorMessage is re-exported and resolves user messages", () => {
    const msg = getFedExUserErrorMessage(new Error("[NOT_FOUND] tracking not found"));
    expect(msg).toBe(FEDEX_ERROR_MESSAGES["NOT_FOUND"]);
  });

  it("isFedExTransientError is re-exported", () => {
    expect(isFedExTransientError("RATE_LIMITED")).toBe(true);
    expect(isFedExTransientError("NOT_FOUND")).toBe(false);
  });
});

// ─── End-to-end config → client → headers flow ───────────────────────────────

describe("Config → Client → Headers integration", () => {
  afterEach(clearFedExEnv);

  it("full flow: env vars → config → client → auth headers", () => {
    setEnv({
      FEDEX_API_BASE_URL:   FEDEX_SANDBOX_BASE_URL,
      FEDEX_ACCOUNT_NUMBER: "ACCT-42",
    });

    const config = getFedExConfig();
    expect(config.isSandbox).toBe(true);
    expect(config.accountNumber).toBe("ACCT-42");

    const client = new FedExHttpClient(config);
    expect(client.isSandbox).toBe(true);
    expect(client.baseUrl).toBe(FEDEX_SANDBOX_BASE_URL);

    const headers = client.buildAuthHeaders("tok-abc");
    expect(headers["Authorization"]).toBe("Bearer tok-abc");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["X-locale"]).toBe("en_US");
    expect(headers["x-customer-transaction-id"]).toBe("ACCT-42");

    const trackUrl = client.buildUrl("/track/v1/trackingnumbers");
    expect(trackUrl).toBe(`${FEDEX_SANDBOX_BASE_URL}/track/v1/trackingnumbers`);
  });

  it("createFedExClient() is a shortcut for getFedExConfig() + new FedExHttpClient()", () => {
    setEnv({ FEDEX_ACCOUNT_NUMBER: "SHORT-1" });

    const manualClient  = new FedExHttpClient(getFedExConfig());
    const factoryClient = createFedExClient();

    // Both should produce identical base properties
    expect(factoryClient.baseUrl).toBe(manualClient.baseUrl);
    expect(factoryClient.isSandbox).toBe(manualClient.isSandbox);
    expect(factoryClient.accountNumber).toBe(manualClient.accountNumber);
  });
});
