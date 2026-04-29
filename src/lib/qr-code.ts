/**
 * QR code generation and parsing utilities for SCAN_INVENTORY case tracking.
 *
 * Each equipment case gets a deterministic unique identifier derived from its
 * Convex record ID.  The identifier is embedded in a structured payload that
 * the SCAN mobile app reads when a technician scans a case label.
 *
 * ── Generation ──────────────────────────────────────────────────────────────
 * Output formats
 *  svg     – inline SVG markup (ideal for server-rendered labels / PDFs)
 *  dataUrl – base64-encoded PNG as a `data:image/png;base64,…` URI
 *              (ideal for <img> tags and canvas-based annotation)
 *
 * Usage (server / Node.js context)
 *   import { generateQrCode } from "@/lib/qr-code";
 *
 *   const qr = await generateQrCode({ caseId: "jx7abc000" });
 *   // qr.svg       → <svg xmlns="…">…</svg>
 *   // qr.dataUrl   → data:image/png;base64,…
 *   // qr.identifier → "CASE-4f3d1a9b2c7e5f0a"  (stable for same caseId)
 *   // qr.payload   → "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a"
 *
 * ── Parsing / Normalization ──────────────────────────────────────────────────
 * The SCAN mobile app receives raw QR output from the device camera.  Two label
 * formats exist in the field:
 *
 *   Generated labels  — structured URLs produced by this utility:
 *     {baseUrl}/case/{caseId}?uid={uid16}&source=generated
 *
 *   External labels   — pre-printed physical labels with arbitrary strings or
 *     legacy asset IDs that were associated with cases via associateQRCodeToCase.
 *
 * Usage (browser / SCAN app)
 *   import { parseQrScan } from "@/lib/qr-code";
 *
 *   const result = parseQrScan(decodedText);
 *   // result.format           → "generated" | "external"
 *   // result.normalizedQrCode → exact string stored as cases.qrCode in Convex
 *   // result.caseId           → Convex document ID (generated labels only, else null)
 *   // result.uid              → uid16 param (generated labels only, else null)
 *   // result.isSystemGenerated → true when source=generated param is present
 */

import { createHash } from "node:crypto";
import QRCode from "qrcode";

import {
  buildQrPayload,
  type QrMetadata,
} from "./qr-code-payload";

export type { QrMetadata };
export { buildQrPayload } from "./qr-code-payload";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QrCodeInput {
  /**
   * Convex record ID for the case.
   * This is the primary lookup key embedded in the QR payload.
   */
  caseId: string;

  /**
   * Optional flat metadata to include in the payload URL as query params.
   * Values are coerced to strings via `String()`.
   */
  metadata?: QrMetadata;

  /**
   * Base URL for the SCAN app (without trailing slash).
   * Defaults to the `NEXT_PUBLIC_SCAN_APP_URL` environment variable,
   * then falls back to `/scan`.
   *
   * The final payload will be: `{baseUrl}/case/{caseId}?uid={uid}&…`
   */
  baseUrl?: string;

  /**
   * QR code pixel size (width/height in px) for the PNG output.
   * Ignored for SVG output (SVG is vector).
   * Defaults to 256.
   */
  size?: number;

  /**
   * Error-correction level.
   * H (30%) is recommended for case labels that may be partially obscured.
   * Defaults to "H".
   */
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
}

export interface QrCodeOutput {
  /**
   * Stable unique identifier for this case label, formatted as
   * "CASE-{16 hex chars}".  Derived deterministically from `caseId` via
   * SHA-256 so the same case always produces the same identifier.
   */
  identifier: string;

  /**
   * The exact string encoded inside the QR code.
   * Format: `{baseUrl}/case/{caseId}?uid={uid16}[&key=value…]`
   */
  payload: string;

  /**
   * Inline SVG markup string (`<svg …>…</svg>`).
   * Safe to inject into HTML with `dangerouslySetInnerHTML` or embed in PDFs.
   */
  svg: string;

  /**
   * PNG QR code encoded as a base64 data URL (`data:image/png;base64,…`).
   * Ready to use as an `<img>` `src` attribute.
   */
  dataUrl: string;
}

// ─── Identifier derivation ─────────────────────────────────────────────────────

/**
 * Derive a stable 16-character hex identifier from a case ID.
 *
 * The identifier is the first 16 hex chars of the SHA-256 digest of the
 * caseId, giving 64 bits of collision resistance — more than sufficient for
 * equipment tracking at any realistic fleet scale.
 */
export function deriveCaseUid(caseId: string): string {
  if (!caseId || caseId.trim().length === 0) {
    throw new Error("deriveCaseUid: caseId must be a non-empty string");
  }
  return createHash("sha256").update(caseId, "utf8").digest("hex").slice(0, 16);
}

/**
 * Build the human-readable label identifier shown on printed case labels.
 * Format: "CASE-{uid16}"
 */
export function buildCaseIdentifier(caseId: string): string {
  return `CASE-${deriveCaseUid(caseId)}`;
}

const DEFAULT_BASE_URL =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_SCAN_APP_URL) ||
  "/scan";

const DEFAULT_SIZE = 256;
const DEFAULT_ECL: QrCodeInput["errorCorrectionLevel"] = "H";

// ─── Main generation export ───────────────────────────────────────────────────

/**
 * Generate a QR code for a SCAN_INVENTORY equipment case.
 *
 * @throws {Error} if `caseId` is empty.
 * @throws {Error} if the underlying QRCode library fails (e.g. payload too large).
 */
export async function generateQrCode(input: QrCodeInput): Promise<QrCodeOutput> {
  const {
    caseId,
    metadata,
    baseUrl = DEFAULT_BASE_URL,
    size = DEFAULT_SIZE,
    errorCorrectionLevel = DEFAULT_ECL,
  } = input;

  if (!caseId || caseId.trim().length === 0) {
    throw new Error("generateQrCode: caseId must be a non-empty string");
  }

  const uid = deriveCaseUid(caseId);
  const identifier = `CASE-${uid}`;
  const payload = buildQrPayload(caseId, uid, baseUrl, metadata);

  const qrOptions: QRCode.QRCodeToStringOptions & QRCode.QRCodeToDataURLOptions =
    {
      errorCorrectionLevel,
      margin: 2,
    };

  const [svg, dataUrl] = await Promise.all([
    QRCode.toString(payload, { ...qrOptions, type: "svg" }),
    QRCode.toDataURL(payload, {
      ...qrOptions,
      type: "image/png",
      width: size,
    }),
  ]);

  return { identifier, payload, svg, dataUrl };
}

// ─── QR scan parsing / normalization ─────────────────────────────────────────
//
// The functions below are safe for browser and server environments — they have
// no dependencies on Node.js built-ins and use only the standard URL API.

/**
 * The format detected from a raw QR scan.
 *
 *   "generated" — a structured URL produced by this utility or the Convex
 *                 `generateQRCodeForCase` mutation.  Contains a `/case/{id}`
 *                 path segment and a `uid` query parameter.
 *
 *   "external"  — a pre-printed physical label with an arbitrary string or
 *                 legacy asset ID.  The raw string is the exact value stored
 *                 in `cases.qrCode` via `associateQRCodeToCase`.
 */
export type QrScanFormat = "generated" | "external";

/**
 * Structured result returned by `parseQrScan`.
 *
 * Use `normalizedQrCode` as the lookup key against the `by_qr_code` Convex
 * index in every case — regardless of format.  For generated labels, you may
 * also use `caseId` to navigate directly to the case detail page without a
 * QR-code index lookup round-trip.
 */
export interface QrScanParseResult {
  /**
   * Detected label format.
   *
   *   "generated" — structured URL with /case/{caseId}?uid=… pattern.
   *   "external"  — arbitrary string or legacy asset ID.
   */
  format: QrScanFormat;

  /**
   * The normalized QR code string used for database lookup.
   *
   * This is ALWAYS the canonical value to pass to `useScanCaseByQrCode` /
   * `validateQrCode` / `associateQRCodeToCase` — it matches exactly what is
   * stored in `cases.qrCode` and indexed by the `by_qr_code` Convex index.
   *
   * For "generated" labels: the full URL string (trimmed of leading/trailing
   * whitespace).
   * For "external" labels: the trimmed raw scan string.
   */
  normalizedQrCode: string;

  /**
   * The Convex document ID extracted from the URL path for "generated" labels.
   *
   * Populated only when `format === "generated"` and the URL contains a
   * `/case/{caseId}` path segment.  URL-decoded (spaces and special chars are
   * restored to their original form).
   *
   * Use this to navigate directly to `/scan/{caseId}` without waiting for a
   * Convex QR-code lookup to resolve.
   *
   * `null` for "external" format labels.
   */
  caseId: string | null;

  /**
   * The `uid` query parameter extracted from generated label URLs.
   *
   * The uid is the first 16 hex characters of a SHA-256 (client-generated) or
   * random UUID (server-generated) that uniquely identifies this specific label
   * instance.  It is stored in the URL as `?uid={uid16}` and embedded in the
   * `CASE-{uid16}` human-readable identifier printed on the label.
   *
   * Useful for:
   *   • Cross-referencing a scanned URL against the printed "CASE-…" label text.
   *   • Diagnosing QR code re-use (uid mismatch between scan and stored value).
   *
   * `null` for "external" format labels or when the `uid` param is absent.
   */
  uid: string | null;

  /**
   * Whether the `source=generated` query parameter is present in the URL.
   *
   * `true` only for system-generated labels produced by `generateQRCodeForCase`
   * (the Convex mutation), which appends `&source=generated` to the payload.
   *
   * Labels generated by the client-side `generateQrCode` utility (this file)
   * do NOT include `source=generated` by default — only the Convex mutation does.
   *
   * Always `false` for "external" format labels.
   */
  isSystemGenerated: boolean;
}

/**
 * Parse and normalize raw QR scan output from the SCAN mobile app camera.
 *
 * Handles both label formats in use at SkySpecs:
 *
 *   1. Generated labels — structured URLs produced by `generateQRCodeForCase`:
 *        https://scan.skyspecs.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a&source=generated
 *        /scan/case/jx7abc000?uid=4f3d1a9b2c7e5f0a
 *
 *   2. External labels — pre-printed physical labels with arbitrary values:
 *        "CASE-001"
 *        "SKY-2024-DRONE-KIT-003"
 *        "7890123456"   (barcode or asset tag number)
 *        "f47ac10b-58cc-4372-a567-0e02b2c3d479"  (legacy UUID label)
 *
 * Normalization rules
 * ───────────────────
 *   • Leading and trailing whitespace is always stripped.
 *   • For generated URL labels: the case ID is URL-decoded from the path.
 *   • For external labels: the trimmed string is used as-is (case is preserved
 *     because the `by_qr_code` index is case-sensitive).
 *
 * The returned `normalizedQrCode` always matches what is stored in `cases.qrCode`
 * and indexed by Convex's `by_qr_code` index — pass it directly to
 * `useScanCaseByQrCode`, `validateQrCode`, or `associateQRCodeToCase`.
 *
 * @param raw  Raw string decoded from the QR code by the device camera or
 *             entered manually in the SCAN app's manual entry field.
 *
 * @returns `QrScanParseResult` — structured parse result with format discriminant,
 *          normalized lookup key, and (for generated labels) extracted caseId and uid.
 *
 * @throws {Error} if `raw` is empty or whitespace-only.
 *
 * @example
 * // Generated label URL
 * const result = parseQrScan("https://scan.skyspecs.com/case/jx7abc000?uid=abc123&source=generated");
 * // result.format           → "generated"
 * // result.normalizedQrCode → "https://scan.skyspecs.com/case/jx7abc000?uid=abc123&source=generated"
 * // result.caseId           → "jx7abc000"
 * // result.uid              → "abc123"
 * // result.isSystemGenerated → true
 *
 * @example
 * // External / physical label
 * const result = parseQrScan("CASE-001");
 * // result.format           → "external"
 * // result.normalizedQrCode → "CASE-001"
 * // result.caseId           → null
 * // result.uid              → null
 * // result.isSystemGenerated → false
 *
 * @example
 * // SCAN app usage — post-scan resolution
 * const { format, normalizedQrCode, caseId } = parseQrScan(decodedText);
 *
 * // Always look up by normalizedQrCode via the by_qr_code index
 * const caseDoc = await getByQrCode(normalizedQrCode);
 *
 * // For generated labels: also navigate directly using caseId
 * if (format === "generated" && caseId) {
 *   router.push(`/scan/${caseId}`);
 * }
 */
export function parseQrScan(raw: string): QrScanParseResult {
  // ── 1. Validate and normalize input ────────────────────────────────────────
  if (raw === null || raw === undefined) {
    throw new Error("parseQrScan: raw scan input must be a non-empty string");
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(
      "parseQrScan: raw scan input must be a non-empty string (got whitespace-only)"
    );
  }

  // ── 2. Attempt URL parsing ──────────────────────────────────────────────────
  //
  // Try three URL forms in order:
  //   a) Absolute URL: "https://scan.skyspecs.com/case/abc123?uid=…"
  //   b) Protocol-relative: "//scan.skyspecs.com/case/abc123?uid=…"
  //   c) Root-relative path: "/scan/case/abc123?uid=…"
  //
  // All three forms are valid generated label payloads.  Anything else (no
  // leading slash, no scheme) is treated as an external label string.

  const DUMMY_BASE = "https://scan.example.com";
  let parsedUrl: URL | null = null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    // a) Standard absolute URL
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      // Malformed absolute URL — treat as external label
    }
  } else if (trimmed.startsWith("//")) {
    // b) Protocol-relative URL — prepend https: before parsing
    try {
      parsedUrl = new URL(`https:${trimmed}`);
    } catch {
      // Malformed — treat as external label
    }
  } else if (trimmed.startsWith("/")) {
    // c) Root-relative path — resolve against dummy base
    try {
      parsedUrl = new URL(trimmed, DUMMY_BASE);
    } catch {
      // Malformed — treat as external label
    }
  }
  // Anything else (no scheme, no leading slash) → not a URL → external label

  // ── 3. Check for /case/{caseId} path segment ──────────────────────────────
  //
  // A generated label URL contains a path segment matching /case/{caseId}.
  // The caseId may be URL-encoded (e.g., slashes → %2F) so we decode it.
  // The pattern matches the first occurrence of /case/ in the path to handle
  // sub-path prefixes like /scan/case/... or /app/scan/case/...
  if (parsedUrl !== null) {
    const casePathMatch = parsedUrl.pathname.match(/\/case\/([^/?#]+)/);

    if (casePathMatch && casePathMatch[1]) {
      const caseId = decodeURIComponent(casePathMatch[1]);
      const uid = parsedUrl.searchParams.get("uid");
      const source = parsedUrl.searchParams.get("source");
      const isSystemGenerated = source === "generated";

      return {
        format:           "generated",
        normalizedQrCode: trimmed,
        caseId,
        uid,
        isSystemGenerated,
      };
    }

    // URL parsed successfully but no /case/{id} pattern → external label
    // (e.g., a URL to some other page stored on a physical label)
  }

  // ── 4. External label — arbitrary string ──────────────────────────────────
  //
  // The trimmed raw string is used verbatim as the QR code lookup key.
  // Case is preserved because the `by_qr_code` index uses an exact match.
  return {
    format:           "external",
    normalizedQrCode: trimmed,
    caseId:           null,
    uid:              null,
    isSystemGenerated: false,
  };
}

/**
 * Normalize a legacy or manually-entered case identifier for display.
 *
 * Applied to values entered via the SCAN app manual entry field to produce a
 * consistent display form before lookup.  Does NOT alter the stored QR code
 * value — only used for UI presentation and form validation.
 *
 * Rules:
 *   1. Trim leading / trailing whitespace.
 *   2. Collapse multiple internal whitespace characters to a single space.
 *   3. Strip any leading forward-slash (accidental paste from URL path).
 *
 * @param raw  The raw string entered by the user.
 * @returns    Normalized string, or an empty string if input was blank.
 *
 * @example
 * normalizeManualEntry("  CASE-001  ")  → "CASE-001"
 * normalizeManualEntry("/CASE-001")     → "CASE-001"
 * normalizeManualEntry("case  001")     → "case 001"
 */
export function normalizeManualEntry(raw: string): string {
  if (!raw) return "";
  return raw
    .trim()
    .replace(/\s+/g, " ")    // collapse internal whitespace
    .replace(/^\/+/, "");    // strip leading slashes
}
