/**
 * label-export.ts — Client-side label PNG export utility.
 *
 * Renders an equipment case label to an offscreen canvas and triggers a
 * browser PNG file download. No external libraries required — uses only the
 * native Canvas 2D API and Web Crypto APIs already available in the browser.
 *
 * Layout mirrors <CaseLabel>:
 *   - Dark header band  : brand name (left) + print date (right)
 *   - Body              : QR code (left column) + metadata fields (right column)
 *   - Light footer band : scan hint + payload URL
 *
 * Colors are resolved from CSS custom properties at call-time via
 * `getComputedStyle(document.documentElement)`, so the exported PNG automatically
 * reflects the currently active light or dark theme.
 *
 * Output PNG dimensions (at the default 200 DPI):
 *   4 × 6"   → 800 × 1200 px
 *   4 × 3"   → 800 × 600 px
 *   2 × 3.5" → 400 × 700 px
 */

"use client";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Physical label size values — mirrors `LabelSize` in CaseLabel.tsx.
 * Kept as a separate type so this utility module has no dependency on
 * the component tree.
 */
export type LabelExportSize = "4x6" | "4x3" | "2x35";

/**
 * Data needed to render the label canvas.
 * The QR fields (`qrDataUrl`, `identifier`, `payload`) are typically
 * supplied by `usePrintLabel`, while the display fields come from Convex.
 */
export interface LabelExportData {
  /** PNG data URL of the QR code — used as the canvas image source. */
  qrDataUrl: string;
  /** Stable identifier: "CASE-{16 hex chars}". */
  identifier: string;
  /** URL payload encoded in the QR code. */
  payload: string;
  /** Human-readable case label (e.g. "CASE-001"). */
  label: string;
  /** Current lifecycle status (e.g. "deployed"). */
  status: string;
  templateName?: string;
  missionName?: string;
  assigneeName?: string;
  locationName?: string;
  notes?: string;
}

export interface DownloadLabelPngOptions {
  /** Data to render on the label. */
  data: LabelExportData;
  /**
   * Physical label size.
   * @default "4x6"
   */
  size?: LabelExportSize;
  /**
   * Output resolution in pixels per inch.
   * @default 200
   */
  dpi?: number;
  /**
   * Download filename base, without the `.png` extension.
   * Defaults to `<label>-label` (e.g. `case-001-label.png`).
   */
  filename?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Physical label dimensions in inches for each size variant. */
const SIZE_INCHES: Record<LabelExportSize, { w: number; h: number }> = {
  "4x6":  { w: 4, h: 6   },
  "4x3":  { w: 4, h: 3   },
  "2x35": { w: 2, h: 3.5 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a CSS custom property value from `:root`.
 * Falls back to `fallback` when running outside a browser (SSR/tests)
 * or when the property is not defined on the root element.
 */
function resolveToken(prop: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(prop)
    .trim();
  return val || fallback;
}

/**
 * Load an `HTMLImageElement` from a data URL or URL string.
 * Returns a promise that resolves when the image is fully decoded.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load QR image for PNG export"));
    img.src = src;
  });
}

/**
 * Truncate `text` to fit within `maxWidth` pixels on the given canvas context,
 * appending an ellipsis ("…") when truncation is required.
 */
function clampText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clamped = text;
  while (clamped.length > 0 && ctx.measureText(clamped + "…").width > maxWidth) {
    clamped = clamped.slice(0, -1);
  }
  return clamped + "…";
}

// ─── Main export function ──────────────────────────────────────────────────────

/**
 * Render a case label to an offscreen canvas and trigger a browser PNG download.
 *
 * Design-token colors are resolved from `getComputedStyle(document.documentElement)`
 * at call time so the exported image matches the active theme.
 *
 * @throws {Error} when called outside a browser context (SSR), when the
 *   Canvas 2D context is unavailable, or when PNG blob creation fails.
 */
export async function downloadLabelAsPng({
  data,
  size = "4x6",
  dpi = 200,
  filename,
}: DownloadLabelPngOptions): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("downloadLabelAsPng must be called in a browser context");
  }

  const { w: wIn, h: hIn } = SIZE_INCHES[size];
  const W = Math.round(wIn * dpi);
  const H = Math.round(hIn * dpi);

  // ── Create offscreen canvas ──────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context not available — PNG export requires a browser with canvas support");
  }

  // ── Resolve design tokens at render time ─────────────────────────────────────
  // Canvas cannot consume CSS custom properties directly, so we read the
  // computed values from the document root. Fallbacks mirror the light-theme
  // semantic token values from base.css §2.
  const colorBg        = resolveToken("--surface-overlay",  "hsl(0, 0%, 100%)");
  const colorInverse   = resolveToken("--surface-inverse",  "hsl(210, 18%, 9%)");
  const colorSubtle    = resolveToken("--surface-sunken",   "hsl(210, 17%, 95%)");
  const colorPrimary   = resolveToken("--ink-primary",      "hsl(210, 18%, 9%)");
  const colorSecondary = resolveToken("--ink-secondary",    "hsl(210, 10%, 38%)");
  const colorTertiary  = resolveToken("--ink-tertiary",     "hsl(210, 9%, 50%)");
  const colorOnInverse = resolveToken("--ink-inverse",      "hsl(0, 0%, 100%)");
  const colorBorder    = resolveToken("--border-default",   "hsl(210, 14%, 89%)");

  // ── Wait for web fonts ───────────────────────────────────────────────────────
  // Ensures "Inter Tight" and "IBM Plex Mono" are loaded before canvas text
  // drawing, preventing silent fallback to the generic system font.
  if (typeof document.fonts !== "undefined") {
    await document.fonts.ready;
  }

  // ── Background fill ──────────────────────────────────────────────────────────
  ctx.fillStyle = colorBg;
  ctx.fillRect(0, 0, W, H);

  // ── Outer border ─────────────────────────────────────────────────────────────
  const borderPx = Math.max(1, Math.round(dpi * 0.004));
  ctx.strokeStyle = colorBorder;
  ctx.lineWidth   = borderPx;
  ctx.strokeRect(borderPx / 2, borderPx / 2, W - borderPx, H - borderPx);

  // ── Header band ──────────────────────────────────────────────────────────────
  const headerH   = Math.round(H * 0.09);
  const headerPad = Math.round(W * 0.03);

  ctx.fillStyle = colorInverse;
  ctx.fillRect(0, 0, W, headerH);

  // Brand name (left-aligned)
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle    = colorOnInverse;
  const brandSize  = Math.round(headerH * 0.40);
  ctx.font         = `bold ${brandSize}px "Inter Tight", "Inter", sans-serif`;
  ctx.fillText("SkySpecs INVENTORY", headerPad, headerH / 2);

  // Print date (right-aligned)
  const printDate = new Date().toISOString().slice(0, 10);
  const dateSize  = Math.round(headerH * 0.30);
  ctx.font        = `${dateSize}px "IBM Plex Mono", monospace`;
  const dateW     = ctx.measureText(printDate).width;
  ctx.fillText(printDate, W - headerPad - dateW, headerH / 2);

  // ── Footer band ───────────────────────────────────────────────────────────────
  const footerH   = Math.round(H * 0.11);
  const footerY   = H - footerH;
  const footerPad = Math.round(W * 0.03);

  ctx.fillStyle = colorSubtle;
  ctx.fillRect(0, footerY, W, footerH);

  // Scan hint text
  const hintSize = Math.round(footerH * 0.22);
  ctx.fillStyle  = colorTertiary;
  ctx.font       = `${hintSize}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "middle";
  ctx.fillText(
    clampText(ctx, "Scan QR code with camera to open in SCAN app", W - footerPad * 2),
    footerPad,
    footerY + footerH * 0.30,
  );

  // Payload URL text
  const payloadSize = Math.round(footerH * 0.19);
  ctx.font = `${payloadSize}px "IBM Plex Mono", monospace`;
  ctx.fillText(
    clampText(ctx, data.payload, W - footerPad * 2),
    footerPad,
    footerY + footerH * 0.70,
  );

  // ── Body ──────────────────────────────────────────────────────────────────────
  const bodyTop = headerH;
  const bodyH   = footerY - headerH;
  const bodyPad = Math.round(W * 0.035);

  // QR code — square, up to 85% of body height and 44% of label width
  const qrSize = Math.min(
    Math.round(bodyH * 0.85),
    Math.round(W * 0.44),
  );
  const qrX = bodyPad;
  const qrY = bodyTop + Math.round((bodyH - qrSize) / 2);

  // Draw QR code image
  try {
    const qrImg = await loadImage(data.qrDataUrl);
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  } catch {
    // Placeholder when QR image fails to load
    ctx.fillStyle = colorSubtle;
    ctx.fillRect(qrX, qrY, qrSize, qrSize);
    ctx.fillStyle    = colorTertiary;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    const phSize = Math.round(qrSize * 0.09);
    ctx.font = `${phSize}px sans-serif`;
    ctx.fillText("QR unavailable", qrX + qrSize / 2, qrY + qrSize / 2);
    ctx.textAlign    = "left";
    ctx.textBaseline = "alphabetic";
  }

  // ── Metadata column ──────────────────────────────────────────────────────────
  const metaX    = qrX + qrSize + Math.round(W * 0.04);
  const metaW    = W - metaX - bodyPad;
  let   metaY    = bodyTop + Math.round(bodyH * 0.08);

  ctx.textAlign    = "left";
  ctx.textBaseline = "top";

  // Case label — large bold text
  const labelFs = Math.min(Math.round(W * 0.065), Math.round(bodyH * 0.12));
  ctx.fillStyle = colorPrimary;
  ctx.font      = `bold ${labelFs}px "Inter Tight", "Inter", sans-serif`;
  ctx.fillText(clampText(ctx, data.label, metaW), metaX, metaY);
  metaY += Math.round(labelFs * 1.5);

  // Status — semibold uppercase
  const statusFs = Math.round(labelFs * 0.52);
  ctx.font       = `600 ${statusFs}px "Inter Tight", "Inter", sans-serif`;
  ctx.fillStyle  = colorSecondary;
  ctx.fillText(data.status.toUpperCase(), metaX, metaY);
  metaY += Math.round(statusFs * 2.4);

  // Field rows: label (tertiary, mono) over value (primary, mono)
  const fieldLabelFs = Math.round(W * 0.026);
  const fieldValueFs = Math.round(W * 0.026);
  const fieldInnerGap = Math.round(fieldLabelFs * 1.4);  // label → value gap
  const fieldOuterGap = Math.round(bodyH * 0.09);        // group-to-group gap

  const fields: Array<[string, string | undefined]> = [
    ["ID",       data.identifier],
    ["Template", data.templateName],
    ["Mission",  data.missionName],
    ["Assigned", data.assigneeName],
    ["Location", data.locationName],
    ["Notes",    data.notes],
  ];

  for (const [fieldLabel, fieldValue] of fields) {
    if (!fieldValue) continue;
    // Stop drawing if we've reached the footer boundary
    if (metaY + fieldOuterGap > footerY - bodyPad) break;

    // Field label (tertiary, smaller)
    ctx.font      = `500 ${fieldLabelFs}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = colorTertiary;
    ctx.fillText(fieldLabel, metaX, metaY);

    // Field value (primary)
    ctx.font      = `${fieldValueFs}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = colorPrimary;
    ctx.fillText(
      clampText(ctx, fieldValue, metaW),
      metaX,
      metaY + fieldInnerGap,
    );

    metaY += fieldOuterGap;
  }

  // ── Trigger download ──────────────────────────────────────────────────────────
  const safeLabel   = data.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const downloadName = filename
    ? `${filename}.png`
    : `${safeLabel}-label.png`;

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create PNG blob from canvas"));
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor    = document.createElement("a");
      anchor.href     = objectUrl;
      anchor.download = downloadName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // Revoke after the browser processes the click event
      setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
      resolve();
    }, "image/png");
  });
}
