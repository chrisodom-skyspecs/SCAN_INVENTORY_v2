/**
 * QR code generation utility for SCAN_INVENTORY case tracking.
 *
 * Each equipment case gets a deterministic unique identifier derived from its
 * Convex record ID.  The identifier is embedded in a structured payload that
 * the SCAN mobile app reads when a technician scans a case label.
 *
 * Output formats
 * ──────────────
 *  svg     – inline SVG markup (ideal for server-rendered labels / PDFs)
 *  dataUrl – base64-encoded PNG as a `data:image/png;base64,…` URI
 *              (ideal for <img> tags and canvas-based annotation)
 *
 * Usage (server / Node.js context)
 * ─────────────────────────────────
 *   import { generateQrCode } from "@/lib/qr-code";
 *
 *   const qr = await generateQrCode({ caseId: "jx7abc000" });
 *   // qr.svg       → <svg xmlns="…">…</svg>
 *   // qr.dataUrl   → data:image/png;base64,…
 *   // qr.identifier → "CASE-4f3d1a9b2c7e5f0a"  (stable for same caseId)
 *   // qr.payload   → "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a"
 */

import { createHash } from "node:crypto";
import QRCode from "qrcode";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Optional metadata key–value pairs that are appended as URL query params
 * inside the QR payload.  Values are coerced to strings.
 *
 * Keep payloads short – QR code density increases with payload length.
 * Prefer storing rich data in Convex and using the caseId as the lookup key.
 */
export type QrMetadata = Record<string, string | number | boolean>;

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

// ─── Payload builder ──────────────────────────────────────────────────────────

const DEFAULT_BASE_URL =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_SCAN_APP_URL) ||
  "/scan";

const DEFAULT_SIZE = 256;
const DEFAULT_ECL: QrCodeInput["errorCorrectionLevel"] = "H";

/**
 * Build the payload string that will be encoded in the QR code.
 *
 * Returns a URL so that scanning with a standard camera app opens the SCAN
 * app directly on the case detail screen.
 */
export function buildQrPayload(
  caseId: string,
  uid: string,
  baseUrl: string,
  metadata?: QrMetadata
): string {
  const params = new URLSearchParams({ uid });

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      params.set(key, String(value));
    }
  }

  return `${baseUrl}/case/${encodeURIComponent(caseId)}?${params.toString()}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

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
