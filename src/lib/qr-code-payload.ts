/**
 * QR payload URL builder — browser-safe (no Node built-ins).
 * Split from qr-code.ts so client bundles avoid `node:crypto`.
 */

export type QrMetadata = Record<string, string | number | boolean>;

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
