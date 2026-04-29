/**
 * Unit tests for the QR code generation and parsing utilities.
 *
 * Run with: npx vitest run
 */

import { describe, it, expect } from "vitest";
import {
  deriveCaseUid,
  buildCaseIdentifier,
  buildQrPayload,
  generateQrCode,
  parseQrScan,
  normalizeManualEntry,
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

// ─── parseQrScan ─────────────────────────────────────────────────────────────

describe("parseQrScan", () => {
  // ── Validation ────────────────────────────────────────────────────────────

  it("throws for an empty string", () => {
    expect(() => parseQrScan("")).toThrow();
  });

  it("throws for a whitespace-only string", () => {
    expect(() => parseQrScan("   ")).toThrow();
  });

  // ── Generated label — absolute https:// URL ───────────────────────────────

  it("detects a generated label from an absolute https URL", () => {
    const raw = "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a&source=generated";
    const result = parseQrScan(raw);
    expect(result.format).toBe("generated");
  });

  it("extracts the caseId from the URL path", () => {
    const raw = "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a";
    const result = parseQrScan(raw);
    expect(result.caseId).toBe("jx7abc000");
  });

  it("extracts the uid query parameter", () => {
    const raw = "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a";
    const result = parseQrScan(raw);
    expect(result.uid).toBe("4f3d1a9b2c7e5f0a");
  });

  it("sets isSystemGenerated=true when source=generated is present", () => {
    const raw = "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a&source=generated";
    const result = parseQrScan(raw);
    expect(result.isSystemGenerated).toBe(true);
  });

  it("sets isSystemGenerated=false when source=generated is absent", () => {
    const raw = "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a";
    const result = parseQrScan(raw);
    expect(result.isSystemGenerated).toBe(false);
  });

  it("preserves the full URL as normalizedQrCode for generated labels", () => {
    const raw = "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a&source=generated";
    const result = parseQrScan(raw);
    expect(result.normalizedQrCode).toBe(raw);
  });

  // ── Generated label — root-relative path ─────────────────────────────────

  it("detects a generated label from a root-relative path starting with /", () => {
    const raw = "/scan/case/abc123?uid=deadbeefcafe0000";
    const result = parseQrScan(raw);
    expect(result.format).toBe("generated");
    expect(result.caseId).toBe("abc123");
    expect(result.uid).toBe("deadbeefcafe0000");
  });

  it("preserves the root-relative path as normalizedQrCode", () => {
    const raw = "/scan/case/abc123?uid=deadbeefcafe0000";
    const result = parseQrScan(raw);
    expect(result.normalizedQrCode).toBe(raw);
  });

  // ── Generated label — protocol-relative URL ───────────────────────────────

  it("detects a generated label from a protocol-relative URL (//)", () => {
    const raw = "//scan.example.com/case/abc123?uid=1234567890abcdef";
    const result = parseQrScan(raw);
    expect(result.format).toBe("generated");
    expect(result.caseId).toBe("abc123");
  });

  // ── Generated label — URL-encoded caseId ─────────────────────────────────

  it("URL-decodes the caseId extracted from the path", () => {
    // caseId "case/with/slashes" would be encoded as "case%2Fwith%2Fslashes"
    const raw = "https://scan.example.com/case/case%2Fwith%2Fslashes?uid=1234567890abcdef";
    const result = parseQrScan(raw);
    expect(result.format).toBe("generated");
    expect(result.caseId).toBe("case/with/slashes");
  });

  it("URL-decodes caseIds with encoded spaces", () => {
    const raw = "https://scan.example.com/case/case%20001?uid=1234567890abcdef";
    const result = parseQrScan(raw);
    expect(result.caseId).toBe("case 001");
  });

  // ── Generated label — sub-path prefix ────────────────────────────────────

  it("handles a /app/scan/case/ prefix before the case path segment", () => {
    const raw = "https://scan.example.com/app/scan/case/abc123?uid=1234567890abcdef";
    const result = parseQrScan(raw);
    expect(result.format).toBe("generated");
    expect(result.caseId).toBe("abc123");
  });

  // ── Generated label — whitespace trimming ─────────────────────────────────

  it("trims leading and trailing whitespace before parsing", () => {
    const raw = "  https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a  ";
    const result = parseQrScan(raw);
    expect(result.format).toBe("generated");
    expect(result.caseId).toBe("jx7abc000");
    // normalizedQrCode should be the trimmed value
    expect(result.normalizedQrCode).toBe(
      "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a"
    );
  });

  // ── Generated label — http:// (non-https) ─────────────────────────────────

  it("handles an http:// generated label URL", () => {
    const raw = "http://scan.example.com/case/abc123?uid=1234567890abcdef";
    const result = parseQrScan(raw);
    expect(result.format).toBe("generated");
    expect(result.caseId).toBe("abc123");
  });

  // ── External labels — plain strings ──────────────────────────────────────

  it("classifies a plain CASE-NNN string as external", () => {
    const result = parseQrScan("CASE-001");
    expect(result.format).toBe("external");
  });

  it("sets normalizedQrCode to the trimmed raw string for external labels", () => {
    const result = parseQrScan("CASE-001");
    expect(result.normalizedQrCode).toBe("CASE-001");
  });

  it("sets caseId to null for external labels", () => {
    const result = parseQrScan("CASE-001");
    expect(result.caseId).toBeNull();
  });

  it("sets uid to null for external labels", () => {
    const result = parseQrScan("CASE-001");
    expect(result.uid).toBeNull();
  });

  it("sets isSystemGenerated to false for external labels", () => {
    const result = parseQrScan("CASE-001");
    expect(result.isSystemGenerated).toBe(false);
  });

  it("classifies a legacy numeric asset tag as external", () => {
    const result = parseQrScan("7890123456");
    expect(result.format).toBe("external");
    expect(result.normalizedQrCode).toBe("7890123456");
  });

  it("classifies a legacy UUID string as external", () => {
    const raw = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const result = parseQrScan(raw);
    expect(result.format).toBe("external");
    expect(result.normalizedQrCode).toBe(raw);
  });

  it("classifies a compound asset tag as external", () => {
    const raw = "SKY-2024-DRONE-KIT-003";
    const result = parseQrScan(raw);
    expect(result.format).toBe("external");
    expect(result.normalizedQrCode).toBe(raw);
  });

  it("preserves original case for external labels (no uppercasing)", () => {
    const result = parseQrScan("Case-Serial-abc");
    expect(result.normalizedQrCode).toBe("Case-Serial-abc");
  });

  it("trims whitespace from external labels", () => {
    const result = parseQrScan("  CASE-001  ");
    expect(result.normalizedQrCode).toBe("CASE-001");
  });

  // ── External labels — URL that does not contain /case/ path ───────────────

  it("classifies a URL without /case/ path as external", () => {
    // A URL to some other page that happens to be on a physical label
    const raw = "https://example.com/asset/12345";
    const result = parseQrScan(raw);
    expect(result.format).toBe("external");
    expect(result.normalizedQrCode).toBe(raw);
    expect(result.caseId).toBeNull();
  });

  it("classifies a bare https:// URL with no path as external", () => {
    const raw = "https://example.com/";
    const result = parseQrScan(raw);
    expect(result.format).toBe("external");
  });

  // ── Round-trip: generate then parse ──────────────────────────────────────

  it("round-trips: payload built by buildQrPayload is parsed as generated", async () => {
    const caseId = "round-trip-case";
    const uid = deriveCaseUid(caseId);
    const payload = buildQrPayload(caseId, uid, "https://scan.example.com");
    const result = parseQrScan(payload);
    expect(result.format).toBe("generated");
    expect(result.caseId).toBe(caseId);
    expect(result.uid).toBe(uid);
    expect(result.normalizedQrCode).toBe(payload);
  });

  it("round-trips: full generateQrCode payload is parsed as generated", async () => {
    const caseId = "full-round-trip";
    const qr = await generateQrCode({ caseId, baseUrl: "https://scan.example.com" });
    const result = parseQrScan(qr.payload);
    expect(result.format).toBe("generated");
    expect(result.caseId).toBe(caseId);
    expect(result.uid).toBe(deriveCaseUid(caseId));
  });

  // ── Convex-format generated URL (uid16 from random UUID, source=generated) ─

  it("parses the Convex mutation payload format correctly", () => {
    // Format produced by convex/qrCodes.ts generateQRCodeForCase mutation:
    // {baseUrl}/case/{encodedCaseId}?uid={uid16}&source=generated
    const caseId = "jx7abc000123456789";
    const uid = "a1b2c3d4e5f60789";
    const raw = `https://scan.skyspecs.com/case/${encodeURIComponent(caseId)}?uid=${uid}&source=generated`;
    const result = parseQrScan(raw);
    expect(result.format).toBe("generated");
    expect(result.caseId).toBe(caseId);
    expect(result.uid).toBe(uid);
    expect(result.isSystemGenerated).toBe(true);
    expect(result.normalizedQrCode).toBe(raw);
  });
});

// ─── normalizeManualEntry ─────────────────────────────────────────────────────

describe("normalizeManualEntry", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeManualEntry("  CASE-001  ")).toBe("CASE-001");
  });

  it("collapses multiple internal spaces to one", () => {
    expect(normalizeManualEntry("case  001")).toBe("case 001");
    expect(normalizeManualEntry("CASE   001   A")).toBe("CASE 001 A");
  });

  it("strips a leading forward-slash", () => {
    expect(normalizeManualEntry("/CASE-001")).toBe("CASE-001");
  });

  it("strips multiple leading forward-slashes", () => {
    expect(normalizeManualEntry("//CASE-001")).toBe("CASE-001");
  });

  it("preserves the original string when no normalization is needed", () => {
    expect(normalizeManualEntry("CASE-001")).toBe("CASE-001");
  });

  it("returns empty string for an empty input", () => {
    expect(normalizeManualEntry("")).toBe("");
  });

  it("returns empty string for a whitespace-only input", () => {
    expect(normalizeManualEntry("   ")).toBe("");
  });

  it("preserves internal hyphens and alphanumerics", () => {
    expect(normalizeManualEntry("SKY-2024-DRONE-KIT-003")).toBe("SKY-2024-DRONE-KIT-003");
  });

  it("preserves letter case", () => {
    expect(normalizeManualEntry("Case-Serial-abc")).toBe("Case-Serial-abc");
  });
});
