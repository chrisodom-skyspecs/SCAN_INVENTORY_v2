/**
 * Unit tests for the QR code generation utility.
 *
 * Run with: npx vitest run
 */

import { describe, it, expect } from "vitest";
import {
  deriveCaseUid,
  buildCaseIdentifier,
  buildQrPayload,
  generateQrCode,
} from "../qr-code";

// ─── deriveCaseUid ────────────────────────────────────────────────────────────

describe("deriveCaseUid", () => {
  it("returns a 16-character lowercase hex string", () => {
    const uid = deriveCaseUid("jx7abc000");
    expect(uid).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — same caseId always yields same uid", () => {
    const id = "case-deterministic-test";
    expect(deriveCaseUid(id)).toBe(deriveCaseUid(id));
  });

  it("produces different uids for different caseIds", () => {
    const uid1 = deriveCaseUid("case-alpha");
    const uid2 = deriveCaseUid("case-beta");
    expect(uid1).not.toBe(uid2);
  });

  it("throws for an empty string", () => {
    expect(() => deriveCaseUid("")).toThrow();
  });

  it("throws for a whitespace-only string", () => {
    expect(() => deriveCaseUid("   ")).toThrow();
  });
});

// ─── buildCaseIdentifier ──────────────────────────────────────────────────────

describe("buildCaseIdentifier", () => {
  it("returns a string prefixed with CASE-", () => {
    const id = buildCaseIdentifier("jx7abc000");
    expect(id).toMatch(/^CASE-[0-9a-f]{16}$/);
  });

  it("is deterministic for the same caseId", () => {
    const id = "stable-case";
    expect(buildCaseIdentifier(id)).toBe(buildCaseIdentifier(id));
  });

  it("differs between different caseIds", () => {
    expect(buildCaseIdentifier("case-a")).not.toBe(buildCaseIdentifier("case-b"));
  });
});

// ─── buildQrPayload ───────────────────────────────────────────────────────────

describe("buildQrPayload", () => {
  const BASE = "https://scan.example.com";

  it("builds a URL with the caseId in the path", () => {
    const payload = buildQrPayload("case123", "uid16hexvalue0000", BASE);
    expect(payload).toContain("/case/case123");
  });

  it("includes the uid as a query param", () => {
    const payload = buildQrPayload("case123", "uid16hexvalue0000", BASE);
    const url = new URL(payload);
    expect(url.searchParams.get("uid")).toBe("uid16hexvalue0000");
  });

  it("includes metadata as additional query params", () => {
    const payload = buildQrPayload("case123", "uid16hexvalue0000", BASE, {
      site: "Chicago",
      kit: 42,
      urgent: true,
    });
    const url = new URL(payload);
    expect(url.searchParams.get("site")).toBe("Chicago");
    expect(url.searchParams.get("kit")).toBe("42");
    expect(url.searchParams.get("urgent")).toBe("true");
  });

  it("URL-encodes caseId path segments", () => {
    const payload = buildQrPayload("case/with/slashes", "uid16hexvalue0000", BASE);
    // The caseId should be percent-encoded in the path
    expect(payload).not.toContain("/case/case/with/slashes");
    expect(payload).toContain("case%2Fwith%2Fslashes");
  });

  it("works without metadata (no extra params)", () => {
    const payload = buildQrPayload("simple", "uid16hexvalue0000", BASE);
    const url = new URL(payload);
    expect([...url.searchParams.keys()]).toEqual(["uid"]);
  });
});

// ─── generateQrCode ───────────────────────────────────────────────────────────

describe("generateQrCode", () => {
  it("returns the expected output shape", async () => {
    const result = await generateQrCode({ caseId: "jx7abc000" });

    expect(result).toHaveProperty("identifier");
    expect(result).toHaveProperty("payload");
    expect(result).toHaveProperty("svg");
    expect(result).toHaveProperty("dataUrl");
  });

  it("identifier follows CASE-{16hex} format", async () => {
    const result = await generateQrCode({ caseId: "test-case-001" });
    expect(result.identifier).toMatch(/^CASE-[0-9a-f]{16}$/);
  });

  it("payload is a string containing the caseId", async () => {
    const result = await generateQrCode({ caseId: "test-case-002" });
    expect(typeof result.payload).toBe("string");
    expect(result.payload).toContain("test-case-002");
  });

  it("svg output starts with <svg and contains valid markup", async () => {
    const result = await generateQrCode({ caseId: "test-case-svg" });
    expect(result.svg.trim()).toMatch(/^<\?xml|^<svg/i);
  });

  it("dataUrl is a valid base64 PNG data URL", async () => {
    const result = await generateQrCode({ caseId: "test-case-png" });
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("is deterministic — same caseId yields same identifier and payload", async () => {
    const id = "deterministic-case";
    const r1 = await generateQrCode({ caseId: id });
    const r2 = await generateQrCode({ caseId: id });
    expect(r1.identifier).toBe(r2.identifier);
    expect(r1.payload).toBe(r2.payload);
  });

  it("different caseIds produce different identifiers", async () => {
    const r1 = await generateQrCode({ caseId: "case-alpha" });
    const r2 = await generateQrCode({ caseId: "case-beta" });
    expect(r1.identifier).not.toBe(r2.identifier);
  });

  it("embeds metadata query params in the payload", async () => {
    const result = await generateQrCode({
      caseId: "meta-case",
      metadata: { site: "Denver", priority: 1 },
      baseUrl: "https://scan.example.com",
    });
    const url = new URL(result.payload);
    expect(url.searchParams.get("site")).toBe("Denver");
    expect(url.searchParams.get("priority")).toBe("1");
  });

  it("respects a custom baseUrl", async () => {
    const result = await generateQrCode({
      caseId: "base-url-case",
      baseUrl: "https://custom.scan.io",
    });
    expect(result.payload.startsWith("https://custom.scan.io")).toBe(true);
  });

  it("throws for an empty caseId", async () => {
    await expect(generateQrCode({ caseId: "" })).rejects.toThrow();
  });

  it("throws for a whitespace-only caseId", async () => {
    await expect(generateQrCode({ caseId: "   " })).rejects.toThrow();
  });

  it("accepts errorCorrectionLevel option without error", async () => {
    const levels = ["L", "M", "Q", "H"] as const;
    for (const ecl of levels) {
      const result = await generateQrCode({
        caseId: `ecl-test-${ecl}`,
        errorCorrectionLevel: ecl,
      });
      expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("accepts a custom size option without error", async () => {
    const result = await generateQrCode({ caseId: "size-test", size: 128 });
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
