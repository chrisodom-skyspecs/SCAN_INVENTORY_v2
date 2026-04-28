/**
 * CaseLabel — print-ready case identification label.
 *
 * Composes a QR code, case identifier, and metadata fields into a
 * formatted label suitable for physical attachment to equipment cases.
 *
 * Features:
 *   - Vector SVG QR code for razor-sharp print output at any DPI
 *   - Three physical label sizes: 4×6" | 4×3" | 2×3.5"
 *   - CSS @media print isolation (hides the rest of the page)
 *   - Design-token colors (no hex literals) — WCAG AA compliant
 *   - IBM Plex Mono for all data fields; Inter Tight for UI text
 *   - Optional "Print Label" button (screen-only)
 *   - Accessible: role="region", semantic <dl> for metadata
 *
 * Usage (with pre-generated QR data from the server):
 * ```tsx
 *   <CaseLabel
 *     data={{
 *       qrSvg: output.svg,
 *       identifier: output.identifier,
 *       payload: output.payload,
 *       label: "CASE-001",
 *       status: "deployed",
 *       templateName: "Inspection Kit",
 *       missionName: "Site A Deployment",
 *       assigneeName: "Jane Doe",
 *       locationName: "Grand Rapids, MI",
 *     }}
 *     size="4x6"
 *     showPrintButton
 *   />
 * ```
 *
 * Usage (with client-side QR generation via usePrintLabel hook):
 * ```tsx
 *   const { qrState, triggerPrint } = usePrintLabel(caseId);
 *
 *   if (qrState.status === "ready") {
 *     return (
 *       <CaseLabel
 *         data={{ ...qrState, label: caseData.label, status: caseData.status }}
 *         showPrintButton={false}
 *       />
 *     );
 *   }
 * ```
 */

"use client";

import * as React from "react";
import { StatusPill, type StatusKind } from "../StatusPill";
import styles from "./CaseLabel.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Physical label size.
 *
 * | Value | Dimensions    | Orientation | Common use |
 * |-------|---------------|-------------|------------|
 * | 4x6   | 4" × 6"       | Portrait    | Shipping / hanging tag (default) |
 * | 4x3   | 4" × 3"       | Landscape   | Flat surface / pelican case lid  |
 * | 2x35  | 2" × 3.5"     | Portrait    | Minimal ID tag / slot label       |
 */
export type LabelSize = "4x6" | "4x3" | "2x35";

/**
 * QR code and case metadata to render on the label.
 * Typically produced by `generateQrCode()` (server) or `usePrintLabel` (client).
 */
export interface CaseLabelData {
  /**
   * Inline SVG string for the QR code.
   * Vector output — prints at any DPI without pixelation.
   * Produced by `generateQrCode({ ... }).svg`.
   */
  qrSvg: string;

  /**
   * PNG data URL fallback (`data:image/png;base64,…`).
   * Rendered as <img> if qrSvg is not available.
   */
  qrDataUrl?: string;

  /**
   * Stable human-readable identifier: "CASE-{16 hex chars}".
   * Deterministically derived from the Convex record ID.
   */
  identifier: string;

  /**
   * The exact URL encoded in the QR code.
   * Displayed in the footer for reference.
   */
  payload: string;

  /**
   * Display label for the case (e.g. "CASE-001").
   * This is the `cases.label` field from Convex.
   */
  label: string;

  /** Current lifecycle status of the case. */
  status: StatusKind;

  /** Name of the applied packing-list template (optional). */
  templateName?: string;

  /** Mission name if the case is assigned to a mission (optional). */
  missionName?: string;

  /** Display name of the current assignee / custodian (optional). */
  assigneeName?: string;

  /** Last known location name (optional). */
  locationName?: string;

  /**
   * Short operational note (optional).
   * Clamped to 2 lines on the label — keep under 120 characters.
   */
  notes?: string;
}

export interface CaseLabelProps {
  /** QR code and case metadata. */
  data: CaseLabelData;

  /**
   * Physical label size.
   * @default "4x6"
   */
  size?: LabelSize;

  /**
   * When true, renders a "Print Label" button above the preview (screen only).
   * @default true
   */
  showPrintButton?: boolean;

  /**
   * Custom label for the print button.
   * @default "Print Label"
   */
  printButtonLabel?: string;

  /**
   * Date to display in the label header as "printed on" date.
   * @default new Date()
   */
  printedAt?: Date;

  /** Additional className applied to the outermost wrapper element. */
  className?: string;

  /**
   * Callback fired when the print button is clicked (before `window.print()`).
   * Use this to do any pre-print setup (e.g., analytics).
   */
  onBeforePrint?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a Date as ISO date (YYYY-MM-DD) for the printed-at field.
 * Intentionally does not use locale formatting so it reads unambiguously
 * on labels that may be scanned internationally.
 */
function formatPrintDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Print-ready equipment case label.
 *
 * Renders a physical label preview on screen and prints a clean,
 * page-isolated version when the user clicks "Print Label" or calls
 * `window.print()` directly.
 */
export function CaseLabel({
  data,
  size = "4x6",
  showPrintButton = true,
  printButtonLabel = "Print Label",
  printedAt,
  className,
  onBeforePrint,
}: CaseLabelProps) {
  const printDate = formatPrintDate(printedAt ?? new Date());

  const handlePrint = React.useCallback(() => {
    onBeforePrint?.();
    window.print();
  }, [onBeforePrint]);

  // Render the QR code — prefer SVG (vector), fall back to PNG data URL
  const qrElement = React.useMemo(() => {
    if (data.qrSvg) {
      return (
        <div
          className={styles.qrCode}
          // SVG from the qrcode library is safe — it contains only SVG elements
          // and no external references or scripts.
          dangerouslySetInnerHTML={{ __html: data.qrSvg }}
          aria-label={`QR code for case ${data.label}`}
          role="img"
        />
      );
    }

    if (data.qrDataUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.qrDataUrl}
          alt={`QR code for case ${data.label}`}
          className={styles.qrCode}
          width={256}
          height={256}
        />
      );
    }

    return (
      <div className={styles.qrPlaceholder} aria-label="QR code not available">
        QR code unavailable
      </div>
    );
  }, [data.qrSvg, data.qrDataUrl, data.label]);

  return (
    <div
      className={[styles.wrapper, className].filter(Boolean).join(" ")}
      data-case-label-root
      data-label-size={size}
    >
      {/* Screen-only print controls */}
      {showPrintButton && (
        <div className={styles.printControls} aria-hidden="false">
          <button
            type="button"
            onClick={handlePrint}
            className={styles.printButton}
            aria-label={`Print label for case ${data.label}`}
          >
            {printButtonLabel}
          </button>
        </div>
      )}

      {/* ── Label (screen preview + print target) ── */}
      <article
        className={styles.label}
        data-label-size={size}
        role="region"
        aria-label={`Case label: ${data.label}`}
      >
        {/* Header band */}
        <header className={styles.header}>
          <span className={styles.brandName}>SkySpecs INVENTORY</span>
          <time className={styles.printDate} dateTime={printDate}>
            {printDate}
          </time>
        </header>

        {/* Body: QR code + metadata */}
        <div className={styles.body}>
          {/* QR code column */}
          <section
            className={styles.qrSection}
            aria-label="QR code"
          >
            {qrElement}
          </section>

          {/* Metadata column */}
          <section className={styles.meta} aria-label="Case metadata">
            {/* Primary display label */}
            <p className={styles.caseLabel}>{data.label}</p>

            {/* Status pill */}
            <div className={styles.statusRow}>
              <StatusPill kind={data.status} filled />
            </div>

            {/* Data fields */}
            <dl className={styles.fields}>
              {/* Stable identifier (always shown) */}
              <div className={`${styles.field} ${styles.fieldIdentifier}`}>
                <dt className={styles.fieldLabel}>ID</dt>
                <dd className={styles.fieldValue}>{data.identifier}</dd>
              </div>

              {data.templateName && (
                <div className={styles.field}>
                  <dt className={styles.fieldLabel}>Template</dt>
                  <dd className={styles.fieldValue}>{data.templateName}</dd>
                </div>
              )}

              {data.missionName && (
                <div className={styles.field}>
                  <dt className={styles.fieldLabel}>Mission</dt>
                  <dd className={styles.fieldValue}>{data.missionName}</dd>
                </div>
              )}

              {data.assigneeName && (
                <div className={styles.field}>
                  <dt className={styles.fieldLabel}>Assigned</dt>
                  <dd className={styles.fieldValue}>{data.assigneeName}</dd>
                </div>
              )}

              {data.locationName && (
                <div className={styles.field}>
                  <dt className={styles.fieldLabel}>Location</dt>
                  <dd className={styles.fieldValue}>{data.locationName}</dd>
                </div>
              )}

              {data.notes && (
                <div className={`${styles.field} ${styles.fieldNotes}`}>
                  <dt className={styles.fieldLabel}>Notes</dt>
                  <dd className={styles.fieldValue}>{data.notes}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>

        {/* Footer band */}
        <footer className={styles.footer}>
          <span className={styles.footerScanHint}>
            Scan QR code with camera to open in SCAN app
          </span>
          <span className={styles.footerPayload} aria-label="QR payload URL">
            {data.payload}
          </span>
        </footer>
      </article>
    </div>
  );
}
