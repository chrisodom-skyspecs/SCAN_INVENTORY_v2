/**
 * AssociateQRClient — QR code scan-to-associate screen
 *
 * Sub-AC 2: Dedicated association screen with three sequential steps:
 *
 *   Step "scan"    — QR input via camera (BarcodeDetector API) or manual entry
 *   Step "confirm" — Case lookup display + conflict check + confirmation button
 *   Step "result"  — Success or recoverable error
 *
 * Camera scanning
 * ───────────────
 * Uses the W3C BarcodeDetector API (supported in Chrome 83+, Edge 83+,
 * Samsung Internet 13+).  A live <video> stream from getUserMedia() is
 * polled via requestAnimationFrame; each frame is sent to
 * BarcodeDetector.detect() which returns decoded barcodes synchronously
 * from the underlying platform decoder.  No third-party library needed.
 *
 * Manual entry fallback
 * ─────────────────────
 * When BarcodeDetector is unavailable OR the user explicitly switches,
 * a plain text <input> accepts the QR payload string directly.  This
 * covers scenarios where camera access is denied or the QR code is
 * supplied via clipboard/email.
 *
 * Case lookup display
 * ───────────────────
 * While the user reviews the scanned QR code:
 *   1. The target case (from the route caseId) is fetched via getCaseById.
 *   2. The scanned QR string is cross-checked via getCaseByQrCode to detect
 *      if it is already mapped to a *different* case (conflict).
 *   3. All data is shown on the confirmation card before any mutation is called.
 *
 * Confirmation step
 * ─────────────────
 * The user sees:
 *   • Target case label + status pill
 *   • The QR payload being associated (truncated for readability)
 *   • A conflict warning if the QR is already on another case
 *   • "Confirm Association" CTA → calls associateQRCodeToCase mutation
 *   • "Rescan" link to go back to the input step
 *
 * Real-time fidelity
 * ──────────────────
 * associateQRCodeToCase patches cases.qrCode + cases.updatedAt.  Convex
 * automatically pushes the change to every subscribed getCaseById /
 * getCaseByQrCode / listCases query within ~100–300 ms, satisfying the
 * ≤ 2-second real-time fidelity requirement on the INVENTORY dashboard.
 *
 * Design system compliance
 * ────────────────────────
 * All colors via CSS custom properties (var(--...)) — no hex literals.
 * StatusPill for all status rendering.  IBM Plex Mono for QR payloads
 * and case labels.  Inter Tight for all other text.
 * Touch targets ≥ 44 × 44 px (WCAG 2.5.5).
 * WCAG AA contrast in both light and dark themes.
 * prefers-reduced-motion respected in the scanner frame + spinner.
 */

"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { StatusPill } from "../../../../components/StatusPill";
import { useKindeUser } from "../../../../hooks/use-kinde-user";
import { useAssociateQRCode } from "../../../../hooks/use-scan-mutations";
import { useScanCaseDetail } from "../../../../hooks/use-scan-queries";
import { trackEvent } from "../../../../lib/telemetry.lib";
import { TelemetryEventName } from "../../../../types/telemetry.types";
import styles from "./page.module.css";

// BarcodeDetector global types are declared in src/types/barcode-detector.d.ts

// ─── Flow step type ───────────────────────────────────────────────────────────

type FlowStep = "scan" | "confirm" | "result";
type InputMode = "camera" | "manual";
type ResultState = "success" | "error";

// ─── Props ────────────────────────────────────────────────────────────────────

interface AssociateQRClientProps {
  caseId: string;
}

// ─── Helper: truncate long QR payloads for display ───────────────────────────

function truncateQR(payload: string, maxLen = 48): string {
  if (payload.length <= maxLen) return payload;
  return `${payload.slice(0, maxLen)}…`;
}

// ─── Helper: format epoch ms ──────────────────────────────────────────────────

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Sub-component: Loading skeleton ─────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className={styles.loadingShell} aria-busy="true" aria-label="Loading case data">
      <div className={styles.skeletonTitle} />
      <div className={styles.skeletonBody} />
      <div className={styles.skeletonBody} style={{ width: "68%" }} />
    </div>
  );
}

// ─── Sub-component: Case not found ───────────────────────────────────────────

function CaseNotFound({ caseId }: { caseId: string }) {
  return (
    <div className={styles.stateBox} role="alert">
      <svg
        className={styles.stateIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        data-kind="error"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className={styles.stateTitle}>Case not found</p>
      <p className={styles.stateBody}>
        No case found for ID{" "}
        <code className={styles.monoChip}>{caseId}</code>.
        Verify the QR code or contact support.
      </p>
    </div>
  );
}

// ─── Sub-component: QR Camera Scanner ────────────────────────────────────────
// Uses BarcodeDetector API. Renders a live camera preview with a targeting
// overlay. Continuously polls frames and emits the first decoded QR code.

interface QrCameraScannerProps {
  /** Called with the decoded QR payload when a QR code is detected. */
  onDetected: (qrCode: string) => void;
  /** Called when the camera cannot be accessed or BarcodeDetector is unavailable. */
  onUnavailable: (reason: string) => void;
  /** Whether scanning is paused (e.g. while confirming a previously detected code). */
  paused?: boolean;
}

function QrCameraScanner({
  onDetected,
  onUnavailable,
  paused = false,
}: QrCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const lastDetectedRef = useRef<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  // ── Initialise BarcodeDetector and camera stream ──────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // 1. Feature-detect BarcodeDetector
      if (typeof window === "undefined" || !window.BarcodeDetector) {
        onUnavailable("BarcodeDetector API not supported in this browser.");
        return;
      }

      // 2. Build detector for QR codes
      try {
        detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        onUnavailable("Could not initialise QR code detector.");
        return;
      }

      // 3. Request camera permission (prefer rear-facing on mobile)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width:  { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof DOMException
            ? err.name === "NotAllowedError"
              ? "Camera access denied. Enable camera permission and try again."
              : err.name === "NotFoundError"
              ? "No camera found on this device."
              : `Camera error: ${err.message}`
            : "Could not access camera.";
        setCameraError(msg);
        onUnavailable(msg);
      }
    }

    init();

    return () => {
      cancelled = true;
      rafRef.current !== null && cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onUnavailable]);

  // ── Scanning loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cameraReady || paused) return;

    let active = true;

    async function scanFrame() {
      if (!active || paused || !detectorRef.current || !videoRef.current) return;
      if (videoRef.current.readyState < 2) {
        // Video not ready yet — wait for next frame
        rafRef.current = requestAnimationFrame(scanFrame);
        return;
      }

      try {
        const barcodes = await detectorRef.current.detect(videoRef.current);
        if (barcodes.length > 0) {
          const qr = barcodes[0].rawValue;
          // Debounce: only emit if different from last detected
          if (qr !== lastDetectedRef.current) {
            lastDetectedRef.current = qr;
            onDetected(qr);
          }
        }
      } catch {
        // Transient decode error — continue scanning
      }

      if (active && !paused) {
        rafRef.current = requestAnimationFrame(scanFrame);
      }
    }

    scanFrame();

    return () => {
      active = false;
      rafRef.current !== null && cancelAnimationFrame(rafRef.current);
    };
  }, [cameraReady, paused, onDetected]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (cameraError) {
    return (
      <div className={styles.cameraError} role="alert">
        <svg
          className={styles.cameraErrorIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M23 7 16 12 23 17V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
        <p className={styles.cameraErrorText}>{cameraError}</p>
      </div>
    );
  }

  return (
    <div className={styles.cameraFrame} aria-label="Camera viewfinder for QR scanning">
      {/* Live video preview */}
      <video
        ref={videoRef}
        className={styles.cameraVideo}
        muted
        playsInline
        autoPlay
        aria-hidden="true"
      />

      {/* Targeting overlay — shows while waiting for camera */}
      {!cameraReady && (
        <div className={styles.cameraLoading} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Starting camera…</span>
        </div>
      )}

      {/* Scan target reticle */}
      {cameraReady && (
        <div className={styles.scanReticle} aria-hidden="true">
          <span className={[styles.reticleCorner, styles.reticleTL].join(" ")} />
          <span className={[styles.reticleCorner, styles.reticleTR].join(" ")} />
          <span className={[styles.reticleCorner, styles.reticleBL].join(" ")} />
          <span className={[styles.reticleCorner, styles.reticleBR].join(" ")} />
        </div>
      )}

      {/* Paused overlay */}
      {paused && (
        <div className={styles.cameraPaused} aria-label="Scanner paused">
          <svg
            className={styles.pauseIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>QR code detected</span>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: Step 1 — QR Input ────────────────────────────────────────

interface QrInputStepProps {
  inputMode: InputMode;
  manualValue: string;
  onManualChange: (value: string) => void;
  onModeToggle: () => void;
  onCameraDetected: (qr: string) => void;
  onCameraUnavailable: (reason: string) => void;
  onManualSubmit: (qr: string) => void;
}

function QrInputStep({
  inputMode,
  manualValue,
  onManualChange,
  onModeToggle,
  onCameraDetected,
  onCameraUnavailable,
  onManualSubmit,
}: QrInputStepProps) {
  const handleManualSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = manualValue.trim();
      if (trimmed) onManualSubmit(trimmed);
    },
    [manualValue, onManualSubmit]
  );

  return (
    <div className={styles.step} data-testid="qr-input-step">
      {/* Step header */}
      <div className={styles.stepHeader}>
        <div className={styles.stepNumberBadge} aria-label="Step 1 of 3">1</div>
        <div>
          <h2 className={styles.stepTitle}>Scan QR Code</h2>
          <p className={styles.stepSubtitle}>
            Point camera at the case label or enter the code manually.
          </p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className={styles.modeToggleRow} role="tablist" aria-label="Input method">
        <button
          role="tab"
          aria-selected={inputMode === "camera"}
          className={[
            styles.modeTab,
            inputMode === "camera" ? styles.modeTabActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => inputMode !== "camera" && onModeToggle()}
          type="button"
        >
          {/* Camera icon */}
          <svg
            className={styles.modeTabIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Camera
        </button>

        <button
          role="tab"
          aria-selected={inputMode === "manual"}
          className={[
            styles.modeTab,
            inputMode === "manual" ? styles.modeTabActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => inputMode !== "manual" && onModeToggle()}
          type="button"
        >
          {/* Keyboard icon */}
          <svg
            className={styles.modeTabIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
          </svg>
          Manual Entry
        </button>
      </div>

      {/* Camera scanner */}
      {inputMode === "camera" && (
        <div className={styles.cameraContainer} role="tabpanel" aria-label="Camera scanner">
          <QrCameraScanner
            onDetected={onCameraDetected}
            onUnavailable={onCameraUnavailable}
            paused={false}
          />
          <p className={styles.cameraHint}>
            Hold the camera steady over the QR code on the case label.
          </p>
        </div>
      )}

      {/* Manual entry */}
      {inputMode === "manual" && (
        <div role="tabpanel" aria-label="Manual QR entry">
          <form onSubmit={handleManualSubmit} noValidate className={styles.manualForm}>
            <div className={styles.fieldGroup}>
              <label htmlFor="manualQR" className={styles.fieldLabel}>
                QR Code Payload
                <span className={styles.fieldRequired} aria-hidden="true"> *</span>
              </label>
              <textarea
                id="manualQR"
                className={styles.fieldTextarea}
                rows={4}
                placeholder="Paste or type the QR code string (e.g. https://scan.example.com/case/…)"
                value={manualValue}
                onChange={(e) => onManualChange(e.target.value)}
                aria-required="true"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
              <span className={styles.fieldHint}>
                The QR payload is the URL or string encoded inside the physical label.
              </span>
            </div>

            <button
              type="submit"
              className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
              disabled={!manualValue.trim()}
            >
              Use This Code
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: QR conflict info banner ───────────────────────────────────

interface ConflictBannerProps {
  existingCaseLabel: string;
  existingCaseId: string;
}

function ConflictBanner({ existingCaseLabel }: ConflictBannerProps) {
  return (
    <div className={styles.conflictBanner} role="alert" aria-live="polite">
      <svg
        className={styles.bannerIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div>
        <strong className={styles.bannerTitle}>QR code already in use</strong>
        <p className={styles.bannerBody}>
          This QR code is currently mapped to{" "}
          <span className={styles.monoInline}>{existingCaseLabel}</span>.
          Confirming will <strong>reassign</strong> it to this case instead.
        </p>
      </div>
    </div>
  );
}

// ─── Sub-component: Already mapped banner ─────────────────────────────────────

function AlreadyMappedBanner() {
  return (
    <div className={styles.infoBanner} role="status" aria-live="polite">
      <svg
        className={styles.bannerIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div>
        <strong className={styles.bannerTitle}>Already associated</strong>
        <p className={styles.bannerBody}>
          This QR code is already mapped to this case. No change is needed.
        </p>
      </div>
    </div>
  );
}

// ─── Sub-component: Step 2 — Confirm ─────────────────────────────────────────

interface ConfirmStepProps {
  caseId: string;
  scannedQR: string;
  onConfirm: () => void;
  onRescan: () => void;
  isSubmitting: boolean;
  submitError: string | null;
}

function ConfirmStep({
  caseId,
  scannedQR,
  onConfirm,
  onRescan,
  isSubmitting,
  submitError,
}: ConfirmStepProps) {
  // Fetch target case by ID via SCAN query layer (real-time subscription).
  // useScanCaseDetail delegates to useCaseById which re-evaluates within
  // ~100–300 ms whenever the cases row changes.
  const caseDoc = useScanCaseDetail(caseId);

  // Pre-flight QR validation: structured result with conflict metadata.
  // This is a real-time subscription — Convex re-evaluates if another client
  // maps the same QR code between capture and this confirmation step.
  // validateQrCode returns richer conflict metadata than getCaseByQrCode,
  // so it remains a direct useQuery (not wrapped by the SCAN layer).
  const qrValidation = useQuery(api.qrCodes.validateQrCode, {
    qrCode: scannedQR,
    caseId: caseId as Id<"cases">,
  });

  // Derive conflict + already-mapped states from the typed validation result
  const isLoadingCase = caseDoc === undefined;
  const isLoadingValidation = qrValidation === undefined;
  const isLoading = isLoadingCase || isLoadingValidation;

  const isAlreadyMapped = qrValidation?.status === "mapped_to_this_case";
  const hasConflict = qrValidation?.status === "mapped_to_other_case";

  return (
    <div className={styles.step} data-testid="confirm-step">
      {/* Step header */}
      <div className={styles.stepHeader}>
        <div className={styles.stepNumberBadge} aria-label="Step 2 of 3">2</div>
        <div>
          <h2 className={styles.stepTitle}>Confirm Association</h2>
          <p className={styles.stepSubtitle}>
            Review the details below before linking this QR code to the case.
          </p>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className={styles.loadingShell} aria-busy="true">
          <div className={styles.skeletonTitle} />
          <div className={styles.skeletonBody} />
          <div className={styles.skeletonBody} style={{ width: "60%" }} />
        </div>
      )}

      {/* Case not found */}
      {!isLoadingCase && caseDoc === null && <CaseNotFound caseId={caseId} />}

      {/* Main confirm card */}
      {!isLoading && caseDoc !== null && caseDoc !== undefined && (
        <>
          {/* Case info card */}
          <section className={styles.caseCard} aria-label="Target case details">
            <div className={styles.caseCardHeader}>
              <h3 className={styles.caseCardTitle}>Target Case</h3>
              <StatusPill
                kind={caseDoc.status as Parameters<typeof StatusPill>[0]["kind"]}
              />
            </div>

            <dl className={styles.caseDetailsGrid}>
              <div className={styles.caseDetailItem}>
                <dt className={styles.caseDetailLabel}>Case ID</dt>
                <dd className={[styles.caseDetailValue, styles.monoValue].join(" ")}>
                  {caseDoc.label}
                </dd>
              </div>

              {caseDoc.locationName && (
                <div className={styles.caseDetailItem}>
                  <dt className={styles.caseDetailLabel}>Location</dt>
                  <dd className={styles.caseDetailValue}>{caseDoc.locationName}</dd>
                </div>
              )}

              {caseDoc.assigneeName && (
                <div className={styles.caseDetailItem}>
                  <dt className={styles.caseDetailLabel}>Assigned To</dt>
                  <dd className={styles.caseDetailValue}>{caseDoc.assigneeName}</dd>
                </div>
              )}

              <div className={styles.caseDetailItem}>
                <dt className={styles.caseDetailLabel}>Last Updated</dt>
                <dd className={[styles.caseDetailValue, styles.timestampValue].join(" ")}>
                  {formatDate(caseDoc.updatedAt)}
                </dd>
              </div>
            </dl>

            {/* Current QR code on this case (if any) */}
            {caseDoc.qrCode && (
              <div className={styles.currentQRRow}>
                <span className={styles.currentQRLabel}>Current QR:</span>
                <span className={styles.currentQRValue}>
                  {truncateQR(caseDoc.qrCode, 36)}
                </span>
              </div>
            )}
          </section>

          {/* QR code being associated */}
          <section className={styles.qrPreviewCard} aria-label="QR code to be associated">
            <div className={styles.qrPreviewHeader}>
              <svg
                className={styles.qrIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="3" height="3" />
                <rect x="18" y="14" width="3" height="3" />
                <rect x="14" y="18" width="3" height="3" />
                <rect x="18" y="18" width="3" height="3" />
              </svg>
              <h3 className={styles.qrPreviewTitle}>QR Code to Associate</h3>
            </div>
            <p className={styles.qrPayloadText} title={scannedQR}>
              {truncateQR(scannedQR)}
            </p>
          </section>

          {/* State banners */}
          {isAlreadyMapped && <AlreadyMappedBanner />}
          {hasConflict && qrValidation?.conflictingCaseLabel && (
            <ConflictBanner
              existingCaseLabel={qrValidation.conflictingCaseLabel}
              existingCaseId={qrValidation.conflictingCaseId ?? ""}
            />
          )}

          {/* Submit error */}
          {submitError && (
            <div
              className={styles.errorBanner}
              role="alert"
              aria-live="assertive"
            >
              <svg
                className={styles.bannerIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{submitError}</span>
            </div>
          )}

          {/* Action row */}
          <div className={styles.actionRow}>
            <button
              type="button"
              className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
              onClick={onRescan}
              disabled={isSubmitting}
            >
              {/* Back arrow icon */}
              <svg
                className={styles.btnIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Rescan
            </button>

            <button
              type="button"
              className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
              onClick={onConfirm}
              disabled={isSubmitting || isAlreadyMapped}
              aria-busy={isSubmitting}
              aria-disabled={isAlreadyMapped}
            >
              {isSubmitting ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  Associating…
                </>
              ) : isAlreadyMapped ? (
                "Already Associated"
              ) : hasConflict ? (
                "Reassign QR Code"
              ) : (
                <>
                  {/* Link icon */}
                  <svg
                    className={styles.btnIcon}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  Confirm Association
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-component: Step 3 — Result ──────────────────────────────────────────

interface ResultStepProps {
  resultState: ResultState;
  caseLabel: string;
  scannedQR: string;
  wasAlreadyMapped: boolean;
  caseId: string;
  onStartOver: () => void;
}

function ResultStep({
  resultState,
  caseLabel,
  scannedQR,
  wasAlreadyMapped,
  caseId,
  onStartOver,
}: ResultStepProps) {
  const isSuccess = resultState === "success";

  return (
    <div
      className={styles.step}
      data-testid="result-step"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Step header */}
      <div className={styles.stepHeader}>
        <div
          className={[
            styles.stepNumberBadge,
            isSuccess ? styles.stepNumberSuccess : styles.stepNumberError,
          ].join(" ")}
          aria-label="Step 3 of 3"
        >
          3
        </div>
        <div>
          <h2 className={styles.stepTitle}>
            {isSuccess ? "Association Complete" : "Association Failed"}
          </h2>
          <p className={styles.stepSubtitle}>
            {isSuccess
              ? wasAlreadyMapped
                ? "This QR code was already linked to this case."
                : "The QR code has been successfully linked to this case."
              : "Something went wrong. See details below."}
          </p>
        </div>
      </div>

      {/* Result visual */}
      <div
        className={[
          styles.resultBox,
          isSuccess ? styles.resultBoxSuccess : styles.resultBoxError,
        ].join(" ")}
        role={isSuccess ? "status" : "alert"}
      >
        {isSuccess ? (
          <svg
            className={styles.resultIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
        ) : (
          <svg
            className={styles.resultIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}

        {isSuccess && (
          <dl className={styles.resultDetails}>
            <div className={styles.resultDetailItem}>
              <dt className={styles.resultDetailLabel}>Case</dt>
              <dd className={[styles.resultDetailValue, styles.monoValue].join(" ")}>
                {caseLabel}
              </dd>
            </div>
            <div className={styles.resultDetailItem}>
              <dt className={styles.resultDetailLabel}>QR Code</dt>
              <dd className={[styles.resultDetailValue, styles.resultQRValue].join(" ")}>
                {truncateQR(scannedQR, 40)}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* Action row */}
      <div className={styles.actionRow}>
        {/* Secondary: associate another */}
        <button
          type="button"
          className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
          onClick={onStartOver}
        >
          Associate Another QR Code
        </button>

        {/* Primary (success only): navigate to case detail — shows QR code */}
        {isSuccess && (
          <Link
            href={`/scan/${caseId}`}
            className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
            aria-label={`View case detail for ${caseLabel} — QR code is now displayed`}
          >
            {/* External / eye icon */}
            <svg
              className={styles.btnIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            View Case
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────

/**
 * AssociateQRClient
 *
 * Orchestrates the 3-step scan-to-associate flow:
 *
 *   Step "scan"    → QrInputStep    (camera + manual entry)
 *   Step "confirm" → ConfirmStep    (case lookup + confirmation)
 *   Step "result"  → ResultStep     (success or error)
 *
 * The case is fetched once at the top level (to display in the page header).
 * getCaseByQrCode cross-checking lives inside ConfirmStep so it only subscribes
 * after a QR code is actually captured, avoiding unnecessary Convex queries.
 */
export function AssociateQRClient({ caseId }: AssociateQRClientProps) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { id: userId, name: userName } = useKindeUser();

  // ── Convex ────────────────────────────────────────────────────────────────
  // useScanCaseDetail delegates to useCaseById via the SCAN query layer.
  // Re-evaluates within ~100–300 ms after associateQRCodeToCase patches
  // cases.qrCode + cases.updatedAt, so the page header reflects the new QR
  // state without a reload.
  const caseDoc = useScanCaseDetail(caseId);
  // useAssociateQRCode wraps associateQRCodeToCase with an optimistic update
  // that immediately reflects the new qrCode on getCaseById before the server
  // confirms the write (rolls back automatically on failure).
  const associateMutation = useAssociateQRCode();

  // ── Flow state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<FlowStep>("scan");
  const [inputMode, setInputMode] = useState<InputMode>("camera");
  const [scannedQR, setScannedQR] = useState<string>("");
  const [manualQR, setManualQR] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultState, setResultState] = useState<ResultState>("success");
  const [wasAlreadyMapped, setWasAlreadyMapped] = useState(false);

  // ── Telemetry: track when the camera scanner becomes active ───────────────
  /**
   * Records epoch ms when the user enters camera scan mode.
   * Used to compute `scanDurationMs` for SCAN_ACTION_QR_SCANNED events.
   * Reset to null when the user leaves camera mode or returns to the scan step.
   */
  const cameraStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (step === "scan" && inputMode === "camera") {
      cameraStartedAtRef.current = Date.now();
    } else {
      // Clear the timer when leaving camera scan mode so stale durations
      // are not reported if the user returns later.
      cameraStartedAtRef.current = null;
    }
  }, [step, inputMode]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /** QR code captured from camera — emit telemetry, advance to confirm step */
  const handleCameraDetected = useCallback(
    (qr: string) => {
      // Compute scan duration from when the camera became active.
      const scanDurationMs =
        cameraStartedAtRef.current !== null
          ? Date.now() - cameraStartedAtRef.current
          : null;

      // Telemetry: successful QR scan via camera (spec §23)
      // timestamp is captured at the moment the QR code is detected so it
      // accurately reflects the scan event time (not the telemetry flush time).
      trackEvent({
        eventCategory: "user_action",
        eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
        app: "scan",
        caseId,
        success: true,
        scanDurationMs,
        // Truncate to 256 chars per spec to bound payload size.
        qrPayload: qr.slice(0, 256),
        method: "camera",
        timestamp: Date.now(),
      });

      setScannedQR(qr);
      setManualQR(""); // clear manual field if switching from manual
      setSubmitError(null);
      setStep("confirm");
    },
    [caseId]
  );

  /**
   * Camera unavailable — emit an appropriate error telemetry event, then
   * fall back to manual entry so the user can still complete the flow.
   *
   * Distinguishes two scenarios:
   *   • Permission denied  → ERROR_CAMERA_DENIED (recoverable via settings)
   *   • Other failure      → ERROR_QR_SCAN_FAILED (device/API issue)
   */
  const handleCameraUnavailable = useCallback(
    (reason: string) => {
      const isPermissionDenied =
        reason.toLowerCase().includes("denied") ||
        reason.toLowerCase().includes("not allowed");

      if (isPermissionDenied) {
        // Telemetry: camera permission denied (spec §23)
        // timestamp is captured at the moment the denial is reported.
        trackEvent({
          eventCategory: "error",
          eventName: TelemetryEventName.ERROR_CAMERA_DENIED,
          app: "scan",
          caseId,
          errorCode: "CAMERA_PERMISSION_DENIED",
          errorMessage: reason.slice(0, 512),
          recoverable: true,
          permissionName: "camera",
          timestamp: Date.now(),
        });
      } else {
        // Telemetry: other camera / API failure (spec §23)
        // timestamp is captured together with attemptDurationMs so both values
        // are anchored to the same wall-clock instant.
        const now = Date.now();
        const attemptDurationMs =
          cameraStartedAtRef.current !== null
            ? now - cameraStartedAtRef.current
            : 0;
        trackEvent({
          eventCategory: "error",
          eventName: TelemetryEventName.ERROR_QR_SCAN_FAILED,
          app: "scan",
          caseId,
          errorCode: "CAMERA_UNAVAILABLE",
          errorMessage: reason.slice(0, 512),
          recoverable: true,
          attemptDurationMs,
          timestamp: now,
        });
      }

      setInputMode("manual");
    },
    [caseId]
  );

  /** Manual QR submitted — emit telemetry, advance to confirm step */
  const handleManualSubmit = useCallback(
    (qr: string) => {
      // Telemetry: successful QR entry via manual input (spec §23)
      // timestamp is captured at form submission so it reflects when the user
      // confirmed the QR string, not when the telemetry client later flushes it.
      trackEvent({
        eventCategory: "user_action",
        eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
        app: "scan",
        caseId,
        success: true,
        // No camera duration for manual entry per spec
        scanDurationMs: null,
        // Truncate to 256 chars per spec to bound payload size.
        qrPayload: qr.slice(0, 256),
        method: "manual_entry",
        timestamp: Date.now(),
      });

      setScannedQR(qr);
      setSubmitError(null);
      setStep("confirm");
    },
    [caseId]
  );

  /** Toggle between camera and manual input modes */
  const handleModeToggle = useCallback(() => {
    setInputMode((m) => (m === "camera" ? "manual" : "camera"));
  }, []);

  /** Go back to the scan step from confirm */
  const handleRescan = useCallback(() => {
    setScannedQR("");
    setSubmitError(null);
    setStep("scan");
  }, []);

  /** Submit the association mutation */
  const handleConfirm = useCallback(async () => {
    if (!scannedQR || !caseDoc) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await associateMutation({
        qrCode:   scannedQR,
        caseId:   caseId as Id<"cases">,
        userId,
        userName,
      });

      setWasAlreadyMapped(result.wasAlreadyMapped);
      setResultState("success");
      setStep("result");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to associate QR code. Please try again.";
      setSubmitError(message);
      // Stay on confirm step so the user can rescan or retry
    } finally {
      setIsSubmitting(false);
    }
  }, [scannedQR, caseDoc, caseId, associateMutation, userId, userName]);

  /** Start over from the result screen */
  const handleStartOver = useCallback(() => {
    setScannedQR("");
    setManualQR("");
    setSubmitError(null);
    setStep("scan");
  }, []);

  // ── Active QR (from camera or manual) ─────────────────────────────────────
  const activeQR = scannedQR || manualQR;

  // ── Progress indicator steps ───────────────────────────────────────────────
  const progressSteps = useMemo(() => [
    { id: "scan",    label: "Scan" },
    { id: "confirm", label: "Confirm" },
    { id: "result",  label: "Done" },
  ] as const, []);

  const currentStepIndex = step === "scan" ? 0 : step === "confirm" ? 1 : 2;

  // ── Render ────────────────────────────────────────────────────────────────

  // Loading state: case doc not yet loaded
  if (caseDoc === undefined) {
    return (
      <div className={styles.page}>
        <LoadingSkeleton />
      </div>
    );
  }

  // Case not found
  if (caseDoc === null) {
    return (
      <div className={styles.page}>
        <CaseNotFound caseId={caseId} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.caseRow}>
          <h1 className={styles.caseLabel}>{caseDoc.label}</h1>
          <StatusPill
            kind={caseDoc.status as Parameters<typeof StatusPill>[0]["kind"]}
          />
        </div>
        <p className={styles.pageSubheading}>Associate QR Code</p>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      {/* ── Progress track ─────────────────────────────────────────────── */}
      <nav
        className={styles.progressTrack}
        aria-label="Association flow progress"
      >
        {progressSteps.map(({ id, label }, idx) => {
          const isDone = idx < currentStepIndex;
          const isActive = idx === currentStepIndex;

          return (
            <div key={id} className={styles.progressStep}>
              <div
                className={[
                  styles.progressDot,
                  isDone ? styles.progressDotDone : "",
                  isActive ? styles.progressDotActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={isActive ? "step" : undefined}
              >
                {isDone ? (
                  <svg
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={styles.progressDotCheck}
                  >
                    <polyline points="2 5 4 7 8 3" />
                  </svg>
                ) : (
                  <span aria-hidden="true">{idx + 1}</span>
                )}
              </div>
              <span
                className={[
                  styles.progressLabel,
                  isActive ? styles.progressLabelActive : "",
                  isDone ? styles.progressLabelDone : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {label}
              </span>
              {idx < progressSteps.length - 1 && (
                <div
                  className={[
                    styles.progressLine,
                    isDone ? styles.progressLineDone : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </nav>

      <div className={styles.divider} aria-hidden="true" />

      {/* ── Step content ───────────────────────────────────────────────── */}
      {step === "scan" && (
        <QrInputStep
          inputMode={inputMode}
          manualValue={manualQR}
          onManualChange={setManualQR}
          onModeToggle={handleModeToggle}
          onCameraDetected={handleCameraDetected}
          onCameraUnavailable={handleCameraUnavailable}
          onManualSubmit={handleManualSubmit}
        />
      )}

      {step === "confirm" && (
        <ConfirmStep
          caseId={caseId}
          scannedQR={activeQR}
          onConfirm={handleConfirm}
          onRescan={handleRescan}
          isSubmitting={isSubmitting}
          submitError={submitError}
        />
      )}

      {step === "result" && (
        <ResultStep
          resultState={resultState}
          caseLabel={caseDoc.label}
          scannedQR={activeQR}
          wasAlreadyMapped={wasAlreadyMapped}
          caseId={caseId}
          onStartOver={handleStartOver}
        />
      )}
    </div>
  );
}
