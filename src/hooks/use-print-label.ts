/**
 * usePrintLabel — client-side QR code generation + print trigger.
 *
 * Generates a QR code for a case ID using the browser's native Web Crypto API
 * (SHA-256) and the isomorphic `qrcode` library, then provides a `triggerPrint`
 * function that calls `window.print()`.
 *
 * This hook is the client-side counterpart to `generateQrCode()` (server/Node.js).
 * Use the server function when rendering labels inside Server Components or
 * API routes; use this hook when the label must be generated on the client.
 *
 * The hook is designed to work with `<CaseLabel>`:
 * ```tsx
 *   function CaseLabelPage({ caseId, caseData }: Props) {
 *     const { qrState, triggerPrint } = usePrintLabel(caseId);
 *
 *     if (qrState.status === "loading" || qrState.status === "idle") {
 *       return <Spinner />;
 *     }
 *     if (qrState.status === "error") {
 *       return <ErrorMessage error={qrState.error} />;
 *     }
 *
 *     return (
 *       <CaseLabel
 *         data={{
 *           qrSvg: qrState.svg,
 *           qrDataUrl: qrState.dataUrl,
 *           identifier: qrState.identifier,
 *           payload: qrState.payload,
 *           label: caseData.label,
 *           status: caseData.status,
 *           templateName: caseData.templateName,
 *         }}
 *         size="4x6"
 *         showPrintButton
 *         onBeforePrint={() => console.log("printing...")}
 *       />
 *     );
 *   }
 * ```
 *
 * Note: The hook uses `crypto.subtle.digest` (Web Crypto API) which is only
 * available in secure contexts (https:// or localhost). Label generation will
 * fail with an error if loaded over plain http.
 */

"use client";

import * as React from "react";
import QRCode from "qrcode";
import { buildQrPayload, type QrMetadata } from "@/lib/qr-code-payload";
import {
  downloadLabelAsPng,
  downloadLabelAsPdf,
  type LabelExportSize,
  type LabelExportData,
} from "@/lib/label-export";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Result of a successful QR code generation.
 * Fields mirror `QrCodeOutput` from the server-side `generateQrCode()`.
 */
export interface QrReadyState {
  status: "ready";
  /** "CASE-{16 hex chars}" — stable across re-renders for the same caseId */
  identifier: string;
  /** URL payload encoded in the QR code */
  payload: string;
  /** Inline SVG string — inject via dangerouslySetInnerHTML or embed in PDF */
  svg: string;
  /** PNG data URL — use as <img> src */
  dataUrl: string;
}

export type QrState =
  | { status: "idle" }
  | { status: "loading" }
  | QrReadyState
  | { status: "error"; error: Error };

export interface UsePrintLabelOptions {
  /**
   * Optional flat metadata appended as URL query params in the QR payload.
   * Keep short — longer payloads increase QR code density.
   */
  metadata?: QrMetadata;

  /**
   * Base URL for the SCAN app (without trailing slash).
   * Defaults to `process.env.NEXT_PUBLIC_SCAN_APP_URL` then `/scan`.
   */
  baseUrl?: string;

  /**
   * QR error-correction level.
   * "H" (30%) is recommended — case labels may be partially obscured.
   * @default "H"
   */
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";

  /**
   * PNG output width in pixels (does not affect SVG output).
   * @default 256
   */
  pngSize?: number;
}

/**
 * Case display metadata supplied to `downloadAsPng`.
 * Does NOT include QR fields (`identifier`, `payload`, `qrDataUrl`) —
 * those are provided automatically from the hook's internal `qrState`.
 */
export interface DownloadPngMeta {
  /** Human-readable case label (e.g. "CASE-001"). */
  label: string;
  /** Current lifecycle status (e.g. "deployed"). */
  status: string;
  templateName?: string;
  missionName?: string;
  assigneeName?: string;
  locationName?: string;
  /** Case creation date — rendered as "YYYY-MM-DD" in the PNG export. */
  createdAt?: string | Date;
  notes?: string;
}

export interface UsePrintLabelResult {
  /** Current state of the QR code generation. */
  qrState: QrState;
  /**
   * Call this to open the browser print dialog.
   * Works best when `<CaseLabel>` with `data-case-label-root` is rendered —
   * its `@media print` CSS will isolate the label from the rest of the page.
   */
  triggerPrint: () => void;
  /**
   * Manually re-trigger QR code generation.
   * Useful if the caseId changes or the initial generation failed.
   */
  regenerate: () => void;
  /**
   * Render the label as a PNG at physical print dimensions and trigger a
   * browser file download. Resolves when the download anchor has been clicked.
   *
   * Only callable when `qrState.status === "ready"`. Throws if the QR code
   * is not yet generated.
   *
   * @param meta   Case display metadata to render on the label.
   * @param size   Physical label size (default: "4x6").
   * @param filename  Download filename base without ".png" extension.
   *                  Defaults to `<label>-label` (e.g. "case-001-label.png").
   */
  downloadAsPng: (
    meta: DownloadPngMeta,
    size?: LabelExportSize,
    filename?: string,
  ) => Promise<void>;
  /**
   * Render the label as a PDF at physical print dimensions and trigger a
   * browser file download. The PDF embeds a JPEG image of the label rendered
   * at high DPI (300 by default). Resolves when the download anchor has been
   * clicked.
   *
   * Only callable when `qrState.status === "ready"`. Throws if the QR code
   * is not yet generated.
   *
   * @param meta      Case display metadata to render on the label.
   * @param size      Physical label size (default: "4x6").
   * @param filename  Download filename base without ".pdf" extension.
   *                  Defaults to `<label>-label` (e.g. "case-001-label.pdf").
   */
  downloadAsPdf: (
    meta: DownloadPngMeta,
    size?: LabelExportSize,
    filename?: string,
  ) => Promise<void>;
}

// ─── Browser-safe UID derivation ──────────────────────────────────────────────

/**
 * Derive a 16-character hex UID from a caseId using the Web Crypto API.
 * Functionally identical to `deriveCaseUid()` in qr-code.ts (which uses
 * Node.js `crypto`), so the identifier is stable across server and client.
 *
 * @throws {DOMException} if called outside a secure context (non-https)
 */
async function deriveCaseUidBrowser(caseId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(caseId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

// ─── Default values ───────────────────────────────────────────────────────────

function resolveBaseUrl(override?: string): string {
  if (override) return override;
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_SCAN_APP_URL
  ) {
    return process.env.NEXT_PUBLIC_SCAN_APP_URL;
  }
  return "/scan";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Generate a QR code for a SCAN_INVENTORY equipment case label, client-side.
 *
 * @param caseId - Convex record ID for the case (e.g. "jx7abc000")
 * @param options - Optional configuration for the QR code
 */
export function usePrintLabel(
  caseId: string,
  options: UsePrintLabelOptions = {}
): UsePrintLabelResult {
  const {
    metadata,
    baseUrl: baseUrlOverride,
    errorCorrectionLevel = "H",
    pngSize = 256,
  } = options;

  const [qrState, setQrState] = React.useState<QrState>({ status: "idle" });

  // Stable token so we can trigger re-generation manually
  const [regenerateToken, setRegenerateToken] = React.useState(0);

  const regenerate = React.useCallback(() => {
    setRegenerateToken((t) => t + 1);
  }, []);

  // Serialize metadata to a stable string for the effect dependency
  const metadataKey = metadata ? JSON.stringify(metadata) : "";

  React.useEffect(() => {
    if (!caseId || caseId.trim().length === 0) {
      setQrState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setQrState({ status: "loading" });

    const baseUrl = resolveBaseUrl(baseUrlOverride);

    (async () => {
      try {
        const uid = await deriveCaseUidBrowser(caseId);
        const identifier = `CASE-${uid}`;
        const payload = buildQrPayload(caseId, uid, baseUrl, metadata);

        const qrOptions = {
          errorCorrectionLevel,
          margin: 2,
        } as const;

        const [svg, dataUrl] = await Promise.all([
          QRCode.toString(payload, { ...qrOptions, type: "svg" }),
          QRCode.toDataURL(payload, {
            ...qrOptions,
            type: "image/png",
            width: pngSize,
          }),
        ]);

        if (!cancelled) {
          setQrState({ status: "ready", identifier, payload, svg, dataUrl });
        }
      } catch (err) {
        if (!cancelled) {
          setQrState({
            status: "error",
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, baseUrlOverride, errorCorrectionLevel, pngSize, metadataKey, regenerateToken]);

  const triggerPrint = React.useCallback(() => {
    if (typeof window !== "undefined") {
      window.print();
    }
  }, []);

  /**
   * Render the label as a PNG image and trigger a browser file download.
   *
   * The QR code fields (`identifier`, `payload`, `qrDataUrl`) are sourced
   * from the current `qrState`. The caller provides only the case display
   * metadata via `meta`.
   *
   * Throws synchronously when `qrState.status !== "ready"`, so callers should
   * gate the action on QR readiness (e.g. disable the button while loading).
   */
  const downloadAsPng = React.useCallback(
    async (
      meta: DownloadPngMeta,
      size: LabelExportSize = "4x6",
      filename?: string,
    ): Promise<void> => {
      if (qrState.status !== "ready") {
        throw new Error(
          "downloadAsPng called before QR code is ready. " +
          "Check qrState.status === 'ready' before invoking."
        );
      }
      const exportData: LabelExportData = {
        qrDataUrl:    qrState.dataUrl,
        identifier:   qrState.identifier,
        payload:      qrState.payload,
        label:        meta.label,
        status:       meta.status,
        templateName: meta.templateName,
        missionName:  meta.missionName,
        assigneeName: meta.assigneeName,
        locationName: meta.locationName,
        createdAt:    meta.createdAt,
        notes:        meta.notes,
      };
      await downloadLabelAsPng({ data: exportData, size, filename });
    },
    [qrState],
  );

  /**
   * Render the label as a PDF file and trigger a browser file download.
   *
   * The QR code fields (`identifier`, `payload`, `qrDataUrl`) are sourced
   * from the current `qrState`. The caller provides only the case display
   * metadata via `meta`.
   *
   * The exported PDF embeds a high-DPI JPEG image of the label in a minimal
   * single-page PDF 1.4 envelope with the correct physical page dimensions.
   *
   * Throws when `qrState.status !== "ready"`, so callers should gate the
   * action on QR readiness (e.g. disable the button while loading).
   */
  const downloadAsPdf = React.useCallback(
    async (
      meta: DownloadPngMeta,
      size: LabelExportSize = "4x6",
      filename?: string,
    ): Promise<void> => {
      if (qrState.status !== "ready") {
        throw new Error(
          "downloadAsPdf called before QR code is ready. " +
          "Check qrState.status === 'ready' before invoking."
        );
      }
      const exportData: LabelExportData = {
        qrDataUrl:    qrState.dataUrl,
        identifier:   qrState.identifier,
        payload:      qrState.payload,
        label:        meta.label,
        status:       meta.status,
        templateName: meta.templateName,
        missionName:  meta.missionName,
        assigneeName: meta.assigneeName,
        locationName: meta.locationName,
        createdAt:    meta.createdAt,
        notes:        meta.notes,
      };
      await downloadLabelAsPdf({ data: exportData, size, filename });
    },
    [qrState],
  );

  return { qrState, triggerPrint, regenerate, downloadAsPng, downloadAsPdf };
}
