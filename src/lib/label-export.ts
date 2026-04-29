/**
 * label-export.ts — Client-side label PNG and PDF export utilities.
 *
 * Renders an equipment case label to an offscreen canvas and triggers a
 * browser file download (PNG or PDF). No external libraries required — uses
 * only the native Canvas 2D API and Web Crypto APIs already available in the
 * browser.
 *
 * Layout mirrors <CaseLabel>:
 *   - Dark header band  : brand name (left) + print date (right)
 *   - Body              : QR code (left column) + metadata fields (right column)
 *   - Light footer band : scan hint + payload URL
 *
 * Colors are resolved from CSS custom properties at call-time via
 * `getComputedStyle(document.documentElement)`, so the exported file automatically
 * reflects the currently active light or dark theme.
 *
 * Output PNG dimensions (at the default 200 DPI):
 *   4 × 6"   → 800 × 1200 px
 *   4 × 3"   → 800 × 600 px
 *   2 × 3.5" → 400 × 700 px
 *
 * Output PDF:
 *   Single-page PDF 1.4 with a JPEG image filling the page.
 *   Page dimensions match the physical label size in points (1 in = 72 pt).
 *   Built without external dependencies using a minimal PDF binary generator.
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
  /** Case creation date — rendered as "YYYY-MM-DD" in the metadata column. */
  createdAt?: string | Date;
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

export interface DownloadLabelPdfOptions {
  /** Data to render on the label. */
  data: LabelExportData;
  /**
   * Physical label size.
   * @default "4x6"
   */
  size?: LabelExportSize;
  /**
   * Canvas resolution in pixels per inch for the embedded image.
   * Higher DPI produces a sharper embedded image but increases file size.
   * @default 300
   */
  dpi?: number;
  /**
   * JPEG encoding quality for the image embedded in the PDF (0–1).
   * Higher quality reduces JPEG artifacts, especially on the QR code modules.
   * @default 0.92
   */
  quality?: number;
  /**
   * Download filename base, without the `.pdf` extension.
   * Defaults to `<label>-label` (e.g. `case-001-label.pdf`).
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

// ─── Shared canvas builder ─────────────────────────────────────────────────────

/**
 * Render a case label to an offscreen `<canvas>` at the specified DPI.
 *
 * This is the shared drawing core used by both `downloadLabelAsPng` and
 * `downloadLabelAsPdf`. The layout mirrors the CSS-rendered `<CaseLabel>`
 * component:
 *   - Dark header band (brand name + date)
 *   - Body (QR code column + metadata column)
 *   - Subtle footer band (scan hint + payload URL)
 *
 * Colors are resolved from CSS custom properties on `document.documentElement`
 * at call time so the exported image reflects the active theme.
 *
 * @throws {Error} when the Canvas 2D context is unavailable (no canvas support)
 */
async function buildLabelCanvas(
  data: LabelExportData,
  size: LabelExportSize,
  dpi: number,
): Promise<HTMLCanvasElement> {
  const { w: wIn, h: hIn } = SIZE_INCHES[size];
  const W = Math.round(wIn * dpi);
  const H = Math.round(hIn * dpi);

  // ── Create offscreen canvas ──────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error(
      "Canvas 2D context not available — label export requires a browser with canvas support"
    );
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
  const fieldLabelFs  = Math.round(W * 0.026);
  const fieldValueFs  = Math.round(W * 0.026);
  const fieldInnerGap = Math.round(fieldLabelFs * 1.4);  // label → value gap
  const fieldOuterGap = Math.round(bodyH * 0.09);        // group-to-group gap

  // Format createdAt to YYYY-MM-DD if present
  let createdAtStr: string | undefined;
  if (data.createdAt) {
    const d = data.createdAt instanceof Date
      ? data.createdAt
      : new Date(data.createdAt as string);
    if (!isNaN(d.getTime())) {
      const y  = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dy = String(d.getDate()).padStart(2, "0");
      createdAtStr = `${y}-${mo}-${dy}`;
    }
  }

  const fields: Array<[string, string | undefined]> = [
    ["ID",       data.identifier],
    ["Template", data.templateName],
    ["Mission",  data.missionName],
    ["Assigned", data.assigneeName],
    ["Location", data.locationName],
    ["Created",  createdAtStr],
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

  return canvas;
}

// ─── PDF binary builder ────────────────────────────────────────────────────────

/**
 * Build a minimal single-page PDF 1.4 file that embeds a JPEG image.
 *
 * Object map:
 *   1 — Catalog
 *   2 — Pages tree
 *   3 — Page (MediaBox = physical label size in points)
 *   4 — Content stream (`q … cm /Im1 Do Q` — scales image to fill page)
 *   5 — Image XObject (Subtype /Image, /Filter /DCTDecode = JPEG)
 *
 * The cross-reference table is built by tracking cumulative byte offsets,
 * so the xref is byte-accurate without a post-processing pass.
 *
 * @param jpegBytes  Raw JPEG binary data (from canvas.toBlob("image/jpeg"))
 * @param widthPx    Image width in pixels  (= canvas.width)
 * @param heightPx   Image height in pixels (= canvas.height)
 * @param widthPt    PDF page width in points  (1 inch = 72 points)
 * @param heightPt   PDF page height in points
 * @returns Raw PDF bytes as a Uint8Array
 */
function buildPdfFromJpeg(
  jpegBytes: Uint8Array,
  widthPx: number,
  heightPx: number,
  widthPt: number,
  heightPt: number,
): Uint8Array {
  const enc = new TextEncoder();

  // Content stream: scale-and-draw the image to fill the page.
  // PDF transformation matrix [a b c d e f]:
  //   a = widthPt, d = heightPt, b=c=e=f=0
  //   Maps the unit-square image to the full page dimensions.
  const contentStr = `q ${widthPt.toFixed(2)} 0 0 ${heightPt.toFixed(2)} 0 0 cm /Im1 Do Q`;
  const contentBytes = enc.encode(contentStr);

  // ── PDF object bytes ─────────────────────────────────────────────────────────
  const pdfHeader = enc.encode("%PDF-1.4\n");

  const obj1Bytes = enc.encode(
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
  );

  const obj2Bytes = enc.encode(
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
  );

  const obj3Bytes = enc.encode(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R` +
    ` /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}]` +
    ` /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj\n`
  );

  // Content stream object.
  // /Length counts only contentBytes; the "\n" before endstream is the
  // required end-of-line marker (not counted per PDF spec §7.3.8.1).
  const obj4HeaderBytes = enc.encode(
    `4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`
  );
  const obj4FooterBytes = enc.encode("\nendstream\nendobj\n");

  // Image XObject: /DCTDecode filter for JPEG.
  // /Length counts only jpegBytes; "\n" before endstream is the EOL marker.
  const obj5HeaderBytes = enc.encode(
    `5 0 obj\n<< /Type /XObject /Subtype /Image` +
    ` /Width ${widthPx} /Height ${heightPx}` +
    ` /ColorSpace /DeviceRGB /BitsPerComponent 8` +
    ` /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  const obj5FooterBytes = enc.encode("\nendstream\nendobj\n");

  // ── Byte-offset accounting ────────────────────────────────────────────────────
  // Track cumulative byte offset from the beginning of the file to build an
  // accurate cross-reference table.
  let offset = 0;
  offset += pdfHeader.length;

  const offset1 = offset;
  offset += obj1Bytes.length;

  const offset2 = offset;
  offset += obj2Bytes.length;

  const offset3 = offset;
  offset += obj3Bytes.length;

  const offset4 = offset;
  offset += obj4HeaderBytes.length + contentBytes.length + obj4FooterBytes.length;

  const offset5 = offset;
  offset += obj5HeaderBytes.length + jpegBytes.length + obj5FooterBytes.length;

  const xrefOffset = offset;

  // ── Cross-reference table ────────────────────────────────────────────────────
  // Each entry is exactly 20 bytes: "OOOOOOOOOO GGGGG F \n"
  //   O = 10-digit byte offset, G = 5-digit generation, F = f (free) or n (in-use)
  const xrefStr =
    "xref\n0 6\n" +
    "0000000000 65535 f \n" +
    `${String(offset1).padStart(10, "0")} 00000 n \n` +
    `${String(offset2).padStart(10, "0")} 00000 n \n` +
    `${String(offset3).padStart(10, "0")} 00000 n \n` +
    `${String(offset4).padStart(10, "0")} 00000 n \n` +
    `${String(offset5).padStart(10, "0")} 00000 n \n`;
  const xrefBytes = enc.encode(xrefStr);

  const trailerStr =
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const trailerBytes = enc.encode(trailerStr);

  // ── Assemble final PDF bytes ──────────────────────────────────────────────────
  const totalSize =
    pdfHeader.length +
    obj1Bytes.length +
    obj2Bytes.length +
    obj3Bytes.length +
    obj4HeaderBytes.length + contentBytes.length + obj4FooterBytes.length +
    obj5HeaderBytes.length + jpegBytes.length + obj5FooterBytes.length +
    xrefBytes.length +
    trailerBytes.length;

  const pdf = new Uint8Array(totalSize);
  let pos = 0;

  function write(bytes: Uint8Array): void {
    pdf.set(bytes, pos);
    pos += bytes.length;
  }

  write(pdfHeader);
  write(obj1Bytes);
  write(obj2Bytes);
  write(obj3Bytes);
  write(obj4HeaderBytes);
  write(contentBytes);
  write(obj4FooterBytes);
  write(obj5HeaderBytes);
  write(jpegBytes);
  write(obj5FooterBytes);
  write(xrefBytes);
  write(trailerBytes);

  return pdf;
}

// ─── Public export functions ──────────────────────────────────────────────────

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

  const canvas = await buildLabelCanvas(data, size, dpi);

  const safeLabel    = data.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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

/**
 * Render a case label to an offscreen canvas and trigger a browser PDF download.
 *
 * The label is rasterized to a JPEG image at the specified DPI, then wrapped in
 * a minimal single-page PDF 1.4 envelope with page dimensions matching the
 * physical label size. No external PDF library is required.
 *
 * The exported PDF will:
 *   - Be a standard PDF 1.4 file openable in all modern PDF viewers
 *   - Have the correct physical page size (4×6", 4×3", or 2×3.5")
 *   - Contain the label image filling the entire page
 *   - Reflect the active theme's design tokens at export time
 *
 * @throws {Error} when called outside a browser context (SSR), when the
 *   Canvas 2D context is unavailable, or when JPEG blob creation fails.
 */
export async function downloadLabelAsPdf({
  data,
  size = "4x6",
  dpi = 300,
  quality = 0.92,
  filename,
}: DownloadLabelPdfOptions): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("downloadLabelAsPdf must be called in a browser context");
  }

  const canvas = await buildLabelCanvas(data, size, dpi);

  const { w: wIn, h: hIn } = SIZE_INCHES[size];
  // PDF point units: 1 inch = 72 points
  const widthPt  = wIn * 72;
  const heightPt = hIn * 72;
  const widthPx  = canvas.width;
  const heightPx = canvas.height;

  // Extract JPEG bytes from the canvas.
  // JPEG is used for the PDF embed because /DCTDecode is a standard PDF filter
  // requiring no additional decode parameters (unlike /FlateDecode PNG).
  // High quality (≥0.92) keeps QR code modules sharp and scannable.
  const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Failed to create JPEG blob from canvas for PDF export"));
        return;
      }
      try {
        const arrayBuffer = await blob.arrayBuffer();
        resolve(new Uint8Array(arrayBuffer));
      } catch (err) {
        reject(err);
      }
    }, "image/jpeg", quality);
  });

  // Build the minimal PDF
  const pdfBytes = buildPdfFromJpeg(jpegBytes, widthPx, heightPx, widthPt, heightPt);

  // Trigger browser download
  const safeLabel    = data.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const downloadName = filename
    ? `${filename}.pdf`
    : `${safeLabel}-label.pdf`;

  // `pdfBytes` is always backed by a plain ArrayBuffer (created via `new Uint8Array(n)`),
  // so the cast to ArrayBuffer is safe and required for the Blob constructor's BlobPart type.
  const blob      = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
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
}
