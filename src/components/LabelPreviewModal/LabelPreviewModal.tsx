/**
 * LabelPreviewModal — INVENTORY dashboard label preview.
 *
 * Renders the equipment case label (QR code + metadata) at its physical print
 * dimensions inside a modal dialog, so operations staff can verify appearance
 * before printing.
 *
 * Features:
 *   - Native <dialog> element (top-layer, Escape to close, ::backdrop scrim)
 *   - Rendered via ReactDOM.createPortal — immune to ancestor overflow/z-index
 *   - Three label size tabs: 4×6" | 4×3" | 2×3.5"
 *   - Client-side QR code generation via usePrintLabel hook
 *   - Loading → ready → error states with retry
 *   - Print button (triggers window.print() with label isolation)
 *   - WCAG AA: keyboard navigation, focus management, ARIA live regions
 *   - Design-token colors only; no hex literals
 *
 * Usage:
 * ```tsx
 *   const [open, setOpen] = React.useState(false);
 *
 *   <button onClick={() => setOpen(true)}>View Label</button>
 *
 *   <LabelPreviewModal
 *     isOpen={open}
 *     onClose={() => setOpen(false)}
 *     caseId="jx7abc000"
 *     caseData={{
 *       label: "CASE-001",
 *       status: "deployed",
 *       templateName: "Inspection Kit",
 *       assigneeName: "Jane Doe",
 *     }}
 *   />
 * ```
 *
 * Print isolation:
 *   CaseLabel's @media print CSS hides the rest of the page (visibility:hidden
 *   on body) and restores visibility only on [data-case-label-root] and its
 *   descendants, regardless of where the label lives in the DOM tree.
 */

"use client";

import * as React from "react";
import * as ReactDOM from "react-dom";
import { CaseLabel, type CaseLabelData, type LabelSize } from "../CaseLabel";
import { usePrintLabel } from "@/hooks/use-print-label";
import { type StatusKind } from "../StatusPill";
import styles from "./LabelPreviewModal.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Label size tab definitions — maps LabelSize values to display text. */
const SIZE_TABS: ReadonlyArray<{
  value: LabelSize;
  /** Physical dimension string shown in mono */
  dim: string;
  /** Short descriptive name */
  name: string;
  /** Full label for aria-label */
  ariaLabel: string;
}> = [
  {
    value: "4x6",
    dim: '4" × 6"',
    name: "Standard",
    ariaLabel: "4 by 6 inch standard label",
  },
  {
    value: "4x3",
    dim: '4" × 3"',
    name: "Compact",
    ariaLabel: "4 by 3 inch compact label",
  },
  {
    value: "2x35",
    dim: '2" × 3.5"',
    name: "Mini",
    ariaLabel: "2 by 3.5 inch mini label",
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Case display data passed to the label preview.
 * Mirrors the optional metadata fields of CaseLabelData (without the QR fields,
 * which are derived from caseId via the usePrintLabel hook).
 */
export interface LabelPreviewCaseData {
  /** Human-readable case identifier (e.g. "CASE-001"). */
  label: string;
  /** Current lifecycle status — drives the StatusPill color. */
  status: StatusKind;
  /** Packing list template name (optional). */
  templateName?: string;
  /** Mission name if the case is assigned to a mission (optional). */
  missionName?: string;
  /** Display name of the current custodian / assignee (optional). */
  assigneeName?: string;
  /** Last known location name (optional). */
  locationName?: string;
  /** Case creation date — shown in metadata as "YYYY-MM-DD" (optional). */
  createdAt?: string | Date;
  /** Short operational note (optional, clamped to 2 lines on the label). */
  notes?: string;
}

export interface LabelPreviewModalProps {
  /** Controls whether the modal is visible. */
  isOpen: boolean;
  /** Called when the user dismisses the modal (close button, Escape, backdrop). */
  onClose: () => void;
  /** Convex record ID for the case — used to generate the QR code. */
  caseId: string;
  /** Case metadata rendered on the label. */
  caseData: LabelPreviewCaseData;
  /**
   * Initial label size shown when the modal first opens.
   * @default "4x6"
   */
  initialSize?: LabelSize;
  /**
   * Callback fired just before window.print() is called.
   * Use for analytics or pre-print state setup.
   */
  onBeforePrint?: () => void;
  /**
   * Callback fired just before the PNG download is triggered.
   * Use for analytics or download tracking.
   */
  onBeforeDownload?: () => void;
  /**
   * Callback fired just before the PDF download is triggered.
   * Use for analytics or download tracking.
   */
  onBeforeExportPdf?: () => void;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

/** Minimal inline printer SVG icon (screen-only, aria-hidden). */
function PrintIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Printer body */}
      <path d="M3 4.5V2.5A.5.5 0 0 1 3.5 2h9a.5.5 0 0 1 .5.5V4.5H3z" />
      <path
        fillRule="evenodd"
        d="M1 5.5A1.5 1.5 0 0 1 2.5 4h11A1.5 1.5 0 0 1 15 5.5v5a1.5 1.5 0 0 1-1.5 1.5H13v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V12H2.5A1.5 1.5 0 0 1 1 10.5v-5zm3 5v3h8v-3H4zm8.5-3a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"
      />
    </svg>
  );
}

/** Minimal inline download-arrow SVG icon (screen-only, aria-hidden). */
function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Arrow pointing down into a tray */}
      <path
        fillRule="evenodd"
        d="M7.47 10.78a.75.75 0 0 0 1.06 0l3-3a.75.75 0 0 0-1.06-1.06L8.75 8.44V2a.75.75 0 0 0-1.5 0v6.44L5.53 6.72a.75.75 0 0 0-1.06 1.06l3 3z"
        clipRule="evenodd"
      />
      <path d="M2 13a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 13z" />
    </svg>
  );
}

/** Minimal inline PDF file SVG icon (screen-only, aria-hidden). */
function PdfIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Document outline with folded corner */}
      <path
        fillRule="evenodd"
        d="M4 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5.414A2 2 0 0 0 13.414 4L10 .586A2 2 0 0 0 8.586 0H4zm4 1.5v3A1.5 1.5 0 0 0 9.5 7H13v6a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 13V3a.5.5 0 0 1 .5-.5H8z"
        clipRule="evenodd"
      />
      {/* "PDF" label abbreviation lines */}
      <path d="M5 9.5a.5.5 0 0 1 .5-.5H7a1 1 0 0 1 0 2H5.5A.5.5 0 0 1 5 10.5V9.5z" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Modal dialog containing a print-dimension preview of the equipment case label.
 *
 * Internally uses the native <dialog> element so focus management,
 * Escape-key handling, and backdrop rendering are handled by the browser.
 */
export function LabelPreviewModal({
  isOpen,
  onClose,
  caseId,
  caseData,
  initialSize = "4x6",
  onBeforePrint,
  onBeforeDownload,
  onBeforeExportPdf,
}: LabelPreviewModalProps) {
  // ── SSR guard — portal requires document.body ─────────────────────
  // Declare before any hooks because hooks must execute in the same order
  // on every render. The mounted check gates the portal render, not the hooks.
  const [isMounted, setIsMounted] = React.useState(false);

  // ── Label size selection ──────────────────────────────────────────
  const [size, setSize] = React.useState<LabelSize>(initialSize);

  // ── Download state ────────────────────────────────────────────────
  /** True while the PNG canvas render + blob creation is in progress. */
  const [isDownloading, setIsDownloading] = React.useState(false);
  /** True while the PDF canvas render + PDF assembly is in progress. */
  const [isExportingPdf, setIsExportingPdf] = React.useState(false);

  // ── Refs ─────────────────────────────────────────────────────────
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  /** Focus the close button on open for immediate keyboard access. */
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  // ── QR code generation ───────────────────────────────────────────
  const { qrState, triggerPrint, regenerate, downloadAsPng, downloadAsPdf } = usePrintLabel(caseId);

  // ── Mount detection (client-only) ─────────────────────────────────
  // We cannot render a portal during SSR because document.body doesn't exist.
  // This effect runs once after hydration to unlock the portal render.
  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  // ── Open / close the native dialog ───────────────────────────────
  // IMPORTANT: isMounted is included in the dependency array.
  // On the first render isMounted=false and the dialog element hasn't been
  // created yet, so dialogRef.current is null. Once isMounted becomes true
  // the dialog is rendered and this effect re-runs to call showModal().
  React.useEffect(() => {
    if (!isMounted) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      // Move focus to close button so keyboard users can immediately act.
      requestAnimationFrame(() => {
        closeButtonRef.current?.focus();
      });
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen, isMounted]);

  // ── Escape key / native dialog close event ───────────────────────
  // The browser fires "cancel" before closing the dialog on Escape.
  // We intercept "cancel" to call onClose() so our controlled isOpen
  // state stays in sync, then let the browser close the dialog.
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      // Prevent the browser from auto-closing — we handle it via isOpen/effect.
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  // ── Backdrop / dialog-frame click → close ────────────────────────
  // When the user clicks the ::backdrop, the browser fires a click event
  // on the <dialog> element itself (not any child). We check that the
  // event target is the dialog element to distinguish backdrop clicks from
  // inner content clicks that bubble up.
  const handleDialogClick = React.useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onClose();
      }
    },
    [onClose]
  );

  // ── Build CaseLabelData when QR is ready ─────────────────────────
  const labelData = React.useMemo<CaseLabelData | null>(() => {
    if (qrState.status !== "ready") return null;
    return {
      qrSvg: qrState.svg,
      qrDataUrl: qrState.dataUrl,
      identifier: qrState.identifier,
      payload: qrState.payload,
      label: caseData.label,
      status: caseData.status,
      templateName: caseData.templateName,
      missionName: caseData.missionName,
      assigneeName: caseData.assigneeName,
      locationName: caseData.locationName,
      createdAt: caseData.createdAt,
      notes: caseData.notes,
    };
  }, [qrState, caseData]);

  // ── Print handler ─────────────────────────────────────────────────
  const handlePrint = React.useCallback(() => {
    onBeforePrint?.();
    triggerPrint();
  }, [onBeforePrint, triggerPrint]);

  // ── Download PNG handler ──────────────────────────────────────────
  /**
   * Renders the current label to an offscreen canvas and triggers a PNG
   * file download. Disabled while the QR code is loading or a previous
   * download is in progress.
   */
  const handleDownloadPng = React.useCallback(async () => {
    if (qrState.status !== "ready" || isDownloading) return;
    onBeforeDownload?.();
    setIsDownloading(true);
    try {
      await downloadAsPng(
        {
          label:        caseData.label,
          status:       caseData.status,
          templateName: caseData.templateName,
          missionName:  caseData.missionName,
          assigneeName: caseData.assigneeName,
          locationName: caseData.locationName,
          createdAt:    caseData.createdAt,
          notes:        caseData.notes,
        },
        size,
        `${caseData.label}-label`,
      );
    } finally {
      setIsDownloading(false);
    }
  }, [qrState.status, isDownloading, onBeforeDownload, downloadAsPng, caseData, size]);

  // ── Export PDF handler ────────────────────────────────────────────
  /**
   * Renders the current label to an offscreen canvas, wraps it in a minimal
   * single-page PDF, and triggers a PDF file download. Disabled while the
   * QR code is loading or a previous export is in progress.
   */
  const handleExportPdf = React.useCallback(async () => {
    if (qrState.status !== "ready" || isExportingPdf) return;
    onBeforeExportPdf?.();
    setIsExportingPdf(true);
    try {
      await downloadAsPdf(
        {
          label:        caseData.label,
          status:       caseData.status,
          templateName: caseData.templateName,
          missionName:  caseData.missionName,
          assigneeName: caseData.assigneeName,
          locationName: caseData.locationName,
          createdAt:    caseData.createdAt,
          notes:        caseData.notes,
        },
        size,
        `${caseData.label}-label`,
      );
    } finally {
      setIsExportingPdf(false);
    }
  }, [qrState.status, isExportingPdf, onBeforeExportPdf, downloadAsPdf, caseData, size]);

  // ── Portal gate ───────────────────────────────────────────────────
  // Return null on the server and on the first client render to avoid
  // hydration mismatches. The modal becomes visible once mounted.
  if (!isMounted) return null;

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────

  const modal = (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="label-preview-dialog-title"
      aria-describedby="label-preview-dialog-desc"
      onClick={handleDialogClick}
      data-testid="label-preview-modal"
    >
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 id="label-preview-dialog-title" className={styles.title}>
            Label Preview
          </h2>
          <p id="label-preview-dialog-desc" className={styles.subtitle}>
            {caseData.label}
          </p>
        </div>

        <button
          ref={closeButtonRef}
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close label preview"
          data-testid="label-preview-close"
        >
          {/* × is the HTML entity for ×; rendered as a proper close glyph */}
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {/* ── Label size selector ── */}
      <div className={styles.sizeBar} role="group" aria-label="Label size">
        <span className={styles.sizeBarLabel} aria-hidden="true">
          Size
        </span>
        <div className={styles.sizeOptions}>
          {SIZE_TABS.map((tab) => {
            const isActive = size === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={tab.ariaLabel}
                className={[
                  styles.sizeTab,
                  isActive ? styles.sizeTabActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setSize(tab.value)}
                data-testid={`size-tab-${tab.value}`}
              >
                <span className={styles.sizeTabDim}>{tab.dim}</span>
                <span className={styles.sizeTabName}>{tab.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Preview area ── */}
      <div className={styles.previewArea} data-testid="label-preview-area">
        {qrState.status === "idle" || qrState.status === "loading" ? (
          <div
            className={styles.loadingState}
            role="status"
            aria-live="polite"
            aria-label="Generating QR code"
            data-testid="label-preview-loading"
          >
            <span className={styles.spinner} aria-hidden="true" />
            <span>Generating QR code…</span>
          </div>
        ) : qrState.status === "error" ? (
          <div
            className={styles.errorState}
            role="alert"
            data-testid="label-preview-error"
          >
            <p className={styles.errorTitle}>QR code generation failed</p>
            <p className={styles.errorDetail}>{qrState.error.message}</p>
            <button
              type="button"
              className={styles.retryButton}
              onClick={regenerate}
              data-testid="label-preview-retry"
            >
              Retry
            </button>
          </div>
        ) : labelData !== null ? (
          <div className={styles.labelWrap}>
            <CaseLabel
              data={labelData}
              size={size}
              showPrintButton={false}
              printedAt={new Date()}
            />
          </div>
        ) : null}
      </div>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        {/* Left side: Cancel */}
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onClose}
          data-testid="label-preview-cancel"
        >
          Cancel
        </button>

        {/* Right side: Download PNG + Download PDF + Print */}
        <div className={styles.footerActions}>
          <button
            type="button"
            className={styles.downloadButton}
            onClick={handleDownloadPng}
            disabled={qrState.status !== "ready" || isDownloading}
            aria-disabled={qrState.status !== "ready" || isDownloading}
            aria-label={
              isDownloading
                ? "Downloading PNG…"
                : "Download label as PNG image"
            }
            data-testid="label-preview-download-png"
          >
            <DownloadIcon className={styles.downloadIcon} />
            {isDownloading ? "Downloading…" : "Download PNG"}
          </button>

          <button
            type="button"
            className={styles.pdfButton}
            onClick={handleExportPdf}
            disabled={qrState.status !== "ready" || isExportingPdf}
            aria-disabled={qrState.status !== "ready" || isExportingPdf}
            aria-label={
              isExportingPdf
                ? "Exporting PDF…"
                : "Download label as PDF file"
            }
            data-testid="label-preview-download-pdf"
          >
            <PdfIcon className={styles.pdfIcon} />
            {isExportingPdf ? "Exporting…" : "Download PDF"}
          </button>

          <button
            type="button"
            className={styles.printButton}
            onClick={handlePrint}
            disabled={qrState.status !== "ready"}
            aria-disabled={qrState.status !== "ready"}
            aria-label="Print label — or save as PDF via browser print dialog"
            data-testid="label-preview-print"
          >
            <PrintIcon className={styles.printIcon} />
            Print
          </button>
        </div>
      </footer>
    </dialog>
  );

  return ReactDOM.createPortal(modal, document.body);
}
