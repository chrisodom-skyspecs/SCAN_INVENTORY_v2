/**
 * QrScannerClient — primary QR scanner screen for the SCAN mobile app
 *
 * AC 240101 Sub-AC 1: Activates the device camera, decodes QR codes using the
 * W3C BarcodeDetector API, and displays the raw scanned value to the technician.
 *
 * AC 240203 Sub-AC 3: Wires the QR scan result to case resolution and routing.
 * After a QR code is detected (camera or manual), the component:
 *   1. Displays the raw decoded value to the technician.
 *   2. Triggers a real-time Convex lookup via `useScanCaseByQrIdentifier` which
 *      queries `getCaseByQrIdentifier` — a multi-strategy resolver that handles:
 *        A. Exact `cases.qrCode` match (generated and physical labels)
 *        B. Embedded Convex case-ID extraction from generated URL patterns
 *        C. Plain case-label matching (for manual entry, e.g. "CASE-001")
 *   3. On successful resolution (`caseDoc._id` available): auto-navigates to
 *      `/scan/{caseDoc._id}` (the SCAN app case detail view).
 *   4. On not-found resolution (`null`): shows an error state with a clear
 *      "QR code not recognised" message and a Scan Again / manual-entry CTA.
 *   5. While resolving (`undefined`): shows an inline spinner so the technician
 *      sees real-time feedback without a blank screen.
 *
 * Flow
 * ────
 * 1. "scanning"    — Camera stream is live; BarcodeDetector polls frames via
 *    requestAnimationFrame. A scan reticle overlay guides the technician.
 * 2. "detected"    — A QR code has been decoded. The raw value is displayed
 *    prominently. The component concurrently resolves the case via Convex:
 *      • resolving (undefined): spinner — "Looking up case…"
 *      • found (Doc<"cases">): success card — auto-navigates to case detail
 *      • not_found (null): error card — scan again / manual entry options
 * 3. "manual"      — Camera unavailable or user toggled. A plain text input
 *    accepts the QR payload; submitting triggers the same detected → Convex
 *    resolution flow as the camera path.
 *
 * Camera strategy
 * ───────────────
 * Uses the W3C BarcodeDetector API (Chrome 83+, Edge 83+, Samsung Internet 13+,
 * Android WebView). No third-party library is needed. Safari / Firefox fall
 * back to manual entry automatically via the `onUnavailable` callback.
 *
 * The scanning loop runs via requestAnimationFrame to stay within the browser
 * paint cycle. Between each detect() call, a successful result debounces by
 * comparing against the last detected value — this prevents duplicate events
 * when the camera dwells on the same QR code.
 *
 * Design system compliance
 * ────────────────────────
 * • CSS custom properties only — no hex literals in component code.
 * • IBM Plex Mono for the raw QR value display.
 * • Inter Tight for all other typography.
 * • Touch targets ≥ 44 × 44 px (WCAG 2.5.5).
 * • WCAG AA contrast in both light and dark themes.
 * • prefers-reduced-motion guards on all animations.
 */

"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useScanCaseByQrIdentifier } from "../../../hooks/use-scan-queries";
import { useRecordScanEvent } from "../../../hooks/use-scan-mutations";
import { useCurrentUser } from "../../../hooks/use-current-user";
import styles from "./page.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────
// BarcodeDetector global types are declared in src/types/barcode-detector.d.ts

type ScanPhase = "scanning" | "detected" | "manual" | "error";

/**
 * Resolved state of the Convex case lookup, derived from the `useQuery` result.
 *   "resolving"  — query in flight (undefined)
 *   "found"      — case document returned; use caseDoc._id for navigation
 *   "not_found"  — all lookup strategies failed (null)
 */
type LookupState = "resolving" | "found" | "not_found";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a display-friendly case identifier from a scanned QR value.
 *
 * Used for informational display in the detected card (not for navigation —
 * navigation uses the Convex document ID from the case lookup result).
 *
 * Supports two formats:
 *   1. A raw case ID or label string (e.g. "CASE-001" or "SKY-A-2024-007")
 *   2. A deep-link URL (e.g. "https://…/scan/CASE-001" or "https://…/case/CASE-001")
 *
 * Returns the extracted identifier or null if no recognizable pattern is found.
 */
function extractCaseId(raw: string): string | null {
  // URL format: extract path segment after /scan/ or /case/
  try {
    const url = new URL(raw);
    const pathMatch = url.pathname.match(/\/(?:scan|case)\/([^/?#]+)/);
    if (pathMatch?.[1]) {
      return decodeURIComponent(pathMatch[1]).toUpperCase();
    }
  } catch {
    // Not a URL — fall through to plain string check
  }

  // Plain string: treat as case ID / label directly
  const trimmed = raw.trim();
  if (trimmed && trimmed.length <= 64 && !/[\s\n]/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

/**
 * Return a short, safe-to-display version of the raw QR value.
 * Truncates at 120 chars with an ellipsis so the UI doesn't overflow.
 */
function abbreviateRaw(raw: string, maxLen = 120): string {
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}…`;
}

// ─── Sub-component: Camera viewfinder ────────────────────────────────────────

interface CameraViewfinderProps {
  /** Called when a QR code is decoded from the camera stream. */
  onDetected: (raw: string) => void;
  /** Called when the camera cannot start or BarcodeDetector is unsupported. */
  onUnavailable: (reason: string) => void;
}

function CameraViewfinder({
  onDetected,
  onUnavailable,
}: CameraViewfinderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const lastDetectedRef = useRef<string | null>(null);
  const onDetectedRef = useRef(onDetected);
  const onUnavailableRef = useRef(onUnavailable);

  const [cameraReady, setCameraReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Keep refs in sync with latest callbacks to avoid stale closures in the RAF loop
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  // ── Initialise BarcodeDetector + camera stream ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // 1. Feature-detect BarcodeDetector
      if (typeof window === "undefined" || !window.BarcodeDetector) {
        const reason = "QR scanning is not supported in this browser. Please enter the code manually.";
        setInitError(reason);
        onUnavailableRef.current(reason);
        return;
      }

      // 2. Instantiate detector for QR codes only
      try {
        detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        const reason = "Could not initialise QR decoder. Please enter the code manually.";
        setInitError(reason);
        onUnavailableRef.current(reason);
        return;
      }

      // 3. Request rear-facing camera access
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
          if (!cancelled) setCameraReady(true);
        }
      } catch (err) {
        if (cancelled) return;
        const reason =
          err instanceof DOMException
            ? err.name === "NotAllowedError"
              ? "Camera access denied. Enable camera permission in your browser settings, then try again."
              : err.name === "NotFoundError"
              ? "No camera found on this device. Please enter the QR code manually."
              : `Camera error: ${err.message}`
            : "Could not access the camera. Please enter the QR code manually.";
        setInitError(reason);
        onUnavailableRef.current(reason);
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // intentionally empty — runs once on mount

  // ── Scanning loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cameraReady) return;

    let active = true;

    async function scanFrame() {
      if (!active) return;
      if (!detectorRef.current || !videoRef.current) return;

      // Wait for video to have frames
      if (videoRef.current.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(scanFrame);
        return;
      }

      try {
        const results = await detectorRef.current.detect(videoRef.current);
        if (results.length > 0) {
          const raw = results[0].rawValue;
          // Debounce: skip re-emitting the same code
          if (raw !== lastDetectedRef.current) {
            lastDetectedRef.current = raw;
            onDetectedRef.current(raw);
          }
        }
      } catch {
        // Transient decode error — swallow and continue
      }

      if (active) {
        rafRef.current = requestAnimationFrame(scanFrame);
      }
    }

    scanFrame();

    return () => {
      active = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [cameraReady]);

  // ── Render: init error ─────────────────────────────────────────────────────
  if (initError) {
    return (
      <div className={styles.cameraError} role="alert" aria-live="assertive">
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
          {/* Crossed-out camera */}
          <path d="M23 7 16 12 23 17V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
        <p className={styles.cameraErrorText}>{initError}</p>
      </div>
    );
  }

  // ── Render: camera viewfinder ──────────────────────────────────────────────
  return (
    <div
      className={styles.viewfinder}
      aria-label="Camera viewfinder — point at a QR code"
      role="img"
    >
      {/* Live camera stream */}
      <video
        ref={videoRef}
        className={styles.cameraVideo}
        muted
        playsInline
        autoPlay
        aria-hidden="true"
      />

      {/* Startup overlay */}
      {!cameraReady && (
        <div className={styles.cameraStartup} aria-live="polite" aria-busy="true">
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.startupLabel}>Starting camera…</span>
        </div>
      )}

      {/* Scan reticle — visible once camera is ready */}
      {cameraReady && (
        <div className={styles.reticle} aria-hidden="true">
          {/* Corner brackets */}
          <span className={[styles.corner, styles.cornerTL].join(" ")} />
          <span className={[styles.corner, styles.cornerTR].join(" ")} />
          <span className={[styles.corner, styles.cornerBL].join(" ")} />
          <span className={[styles.corner, styles.cornerBR].join(" ")} />
          {/* Animated scan line */}
          <span className={styles.scanLine} />
        </div>
      )}


    </div>
  );
}

// ─── Sub-component: Detected value display ─────────────────────────────────────

interface DetectedValueProps {
  raw: string;
  /** Display-friendly extracted identifier (for informational rendering only). */
  caseId: string | null;
  /**
   * State of the Convex case lookup:
   *   "resolving"  — query in-flight; show spinner
   *   "found"      — case found; show success and await auto-navigation
   *   "not_found"  — QR code unrecognised in system; show error UI
   */
  lookupState: LookupState;
  /** Case label from the resolved case document (only defined when lookupState === "found"). */
  foundCaseLabel?: string;
  /** Convex document ID of the resolved case (only defined when lookupState === "found"). */
  foundCaseId?: string;
  onScanAgain: () => void;
  /**
   * Called when the user explicitly taps "Open Case" after lookup resolves.
   * Receives the Convex document ID of the resolved case.
   */
  onOpenCase: (convexId: string) => void;
}

function DetectedValueDisplay({
  raw,
  caseId,
  lookupState,
  foundCaseLabel,
  foundCaseId,
  onScanAgain,
  onOpenCase,
}: DetectedValueProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2000);
    }
  }, [raw]);

  return (
    <div
      className={styles.detectedCard}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="QR code detected"
      data-testid="qr-detected-card"
    >
      {/* Header row */}
      <div className={styles.detectedHeader}>
        <div className={styles.detectedIconWrap} aria-hidden="true">
          <svg
            className={styles.detectedIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <p className={styles.detectedLabel}>QR Code Detected</p>
          {caseId && (
            <p className={styles.detectedSublabel}>
              Case identifier extracted
            </p>
          )}
        </div>
      </div>

      {/* Raw value */}
      <div className={styles.rawValueSection} aria-label="Scanned QR value">
        <p className={styles.rawValueHeading}>Raw value</p>
        <div className={styles.rawValueBox}>
          <code
            className={styles.rawValueText}
            data-testid="qr-raw-value"
            title={raw}
          >
            {abbreviateRaw(raw)}
          </code>
          {/* Copy button */}
          <button
            type="button"
            className={styles.copyBtn}
            onClick={handleCopy}
            aria-label={copied ? "Copied to clipboard" : "Copy raw value to clipboard"}
            title={copied ? "Copied!" : "Copy raw value"}
          >
            {copied ? (
              <svg
                className={styles.copyBtnIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : copyError ? (
              <svg
                className={styles.copyBtnIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg
                className={styles.copyBtnIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            <span className={styles.srOnly}>
              {copied ? "Copied" : copyError ? "Copy failed" : "Copy"}
            </span>
          </button>
        </div>
        {raw.length > 120 && (
          <p className={styles.truncatedNote} aria-live="polite">
            Value truncated for display — full value copied to clipboard.
          </p>
        )}
      </div>

      {/* Extracted display identifier (when present) */}
      {caseId && (
        <div className={styles.caseIdSection}>
          <p className={styles.caseIdHeading}>Extracted case ID</p>
          <p className={styles.caseIdValue} data-testid="qr-case-id">
            {caseId}
          </p>
        </div>
      )}

      {/* ── Convex lookup state ── */}

      {/* Resolving: lookup in flight */}
      {lookupState === "resolving" && (
        <div
          className={styles.lookupResolving}
          role="status"
          aria-live="polite"
          aria-label="Looking up case in system"
          data-testid="qr-lookup-resolving"
        >
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.lookupResolvingText}>
            Looking up case in system…
          </span>
        </div>
      )}

      {/* Not found: QR code unrecognised */}
      {lookupState === "not_found" && (
        <div
          className={styles.lookupNotFound}
          role="alert"
          aria-live="assertive"
          data-testid="qr-lookup-not-found"
        >
          <svg
            className={styles.lookupNotFoundIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className={styles.lookupNotFoundText}>
            QR code not recognised in system. This label is not linked to any
            known case.
          </p>
        </div>
      )}

      {/* Found: case resolved */}
      {lookupState === "found" && foundCaseLabel && (
        <div
          className={styles.lookupFound}
          role="status"
          aria-live="polite"
          data-testid="qr-lookup-found"
        >
          <svg
            className={styles.lookupFoundIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className={styles.lookupFoundText}>
            Case found:{" "}
            <strong data-testid="qr-found-case-label">{foundCaseLabel}</strong>
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className={styles.detectedActions}>
        {lookupState === "found" && foundCaseId ? (
          /* Case resolved: allow explicit open (auto-navigation also fires via useEffect) */
          <button
            type="button"
            className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
            onClick={() => onOpenCase(foundCaseId)}
            data-testid="qr-open-case-btn"
          >
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
            Open Case
          </button>
        ) : lookupState === "not_found" ? (
          /* Not found: encourage re-scan */
          <Link
            href="/scan"
            className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
            data-testid="qr-not-found-home-link"
          >
            Go to Scanner Home
          </Link>
        ) : null /* Resolving: no CTA yet */}

        <button
          type="button"
          className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
          onClick={onScanAgain}
          data-testid="qr-scan-again-btn"
        >
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
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-.04-4.07" />
          </svg>
          Scan Again
        </button>
      </div>
    </div>
  );
}

// ─── Sub-component: Manual entry fallback ────────────────────────────────────

interface ManualEntryProps {
  onSubmit: (value: string) => void;
  unavailableReason?: string | null;
}

function ManualEntryFallback({ onSubmit, unavailableReason }: ManualEntryProps) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed) return;
      onSubmit(trimmed);
    },
    [value, onSubmit]
  );

  return (
    <div className={styles.manualEntry}>
      {unavailableReason && (
        <div className={styles.unavailableBanner} role="alert">
          <svg
            className={styles.unavailableIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{unavailableReason}</span>
        </div>
      )}

      <div className={styles.manualHeader}>
        <h2 className={styles.manualTitle}>Enter QR Code Manually</h2>
        <p className={styles.manualSubtitle}>
          Type or paste the QR code string from the case label.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className={styles.manualForm}>
        <div className={styles.manualFieldGroup}>
          <label htmlFor="manualQrValue" className={styles.manualFieldLabel}>
            QR code value
          </label>
          <textarea
            id="manualQrValue"
            className={styles.manualTextarea}
            rows={4}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste or type the QR code string here (e.g. https://scan.skyspecsops.com/scan/CASE-001)"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-required="true"
            data-testid="manual-qr-input"
          />
          <p className={styles.manualFieldHint}>
            The QR code value is the URL or string encoded inside the physical
            label printed on the equipment case.
          </p>
        </div>

        <button
          type="submit"
          className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
          disabled={!value.trim()}
          data-testid="manual-qr-submit"
        >
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
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          Decode QR Code
        </button>
      </form>
    </div>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────

/**
 * QrScannerClient
 *
 * The primary QR scanner screen for the SCAN mobile app.
 *
 * Renders in three phases:
 *   "scanning" → live camera + BarcodeDetector polling
 *   "detected" → raw value display + Convex case resolution + navigation
 *   "manual"   → text input fallback (camera unavailable or user toggled)
 *
 * Case resolution flow (Sub-AC 3):
 *   After detection, `useScanCaseByQrIdentifier(rawValue)` fires a real-time
 *   Convex query.  When the lookup resolves to a case document, a `useEffect`
 *   automatically calls `router.push('/scan/{caseDoc._id}')` to navigate the
 *   technician to the case detail view.  If the lookup returns null (unrecognised
 *   QR code), an error card is shown with a "Scan Again" CTA.
 */
export function QrScannerClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<ScanPhase>("scanning");
  const [rawValue, setRawValue] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  // ── Convex case lookup ─────────────────────────────────────────────────────
  // Subscribes to getCaseByQrIdentifier when rawValue is set.
  // Returns undefined (loading) | null (not found) | Doc<"cases"> (found).
  // The skip pattern (`null` rawValue) ensures no Convex traffic before a scan.
  const caseDoc = useScanCaseByQrIdentifier(rawValue);

  // ── Identity for scan attribution ──────────────────────────────────────────
  // useCurrentUser returns the Kinde user identity; the id and name are
  // written to scans.scannedBy / scans.scannedByName so the immutable history
  // row attributes the scan to the technician who performed it.
  const currentUser = useCurrentUser();

  // ── Convex mutation: record QR scan in immutable history ───────────────────
  // recordScanEvent inserts an append-only row into the `scans` table. The
  // INSERT invalidates getScansByCase, getLastScanForCase, getScansByUser, and
  // getRecentScans — pushing the live update to all subscribers within the
  // ≤ 2-second real-time fidelity window.
  const recordScan = useRecordScanEvent();

  // ── Per-case scan-recording dedupe ─────────────────────────────────────────
  // The Convex case lookup may re-evaluate during the brief window between
  // detection and navigation (e.g., when reactive subscriptions push updated
  // case fields). Without dedupe the recordScan effect would fire a second
  // time for the same physical scan and double-write the history table.
  // Track the case _id we have already recorded for the current rawValue.
  const recordedForCaseRef = useRef<string | null>(null);

  // Derive the lookup state for the detected-card sub-component
  const lookupState: LookupState =
    caseDoc === undefined ? "resolving" :
    caseDoc === null      ? "not_found" :
                            "found";

  // ── Record scan event on successful lookup ─────────────────────────────────
  // When the QR code resolves to a case, write an immutable scan row BEFORE
  // navigating away. The mutation is fire-and-forget: we do not block the
  // navigation on its completion because:
  //   (a) optimistic / reactive subscriptions pick up the row on arrival, and
  //   (b) navigation latency must remain unaffected by network conditions.
  // If the mutation fails (e.g., transient network blip), the navigation
  // still succeeds and the user can re-scan; the failure is logged to the
  // console for diagnostics but never surfaced to the technician — the scan
  // history is not user-visible at this stage and the case data is intact.
  useEffect(() => {
    if (
      phase === "detected" &&
      caseDoc !== undefined &&
      caseDoc !== null &&
      rawValue !== null &&
      // Don't record for partial identities (still loading) — the scan row
      // requires a Kinde user ID and name. Once identity resolves, the effect
      // re-runs and records the scan correctly attributed to the user.
      !currentUser.isLoading &&
      currentUser.id &&
      // Skip if we have already recorded this scan for this case
      recordedForCaseRef.current !== caseDoc._id
    ) {
      recordedForCaseRef.current = caseDoc._id;
      // Fire-and-forget: do not await so navigation is not delayed by the
      // round-trip. recordScanEvent is idempotent at the row level — the
      // dedupe ref above guarantees we do not double-write within this scan.
      recordScan({
        caseId:        caseDoc._id,
        qrPayload:     rawValue,
        scannedBy:     currentUser.id,
        scannedByName: currentUser.name,
        scannedAt:     Date.now(),
        // scanContext "lookup" indicates an informational scan with no status
        // transition — downstream workflows (check-in, inspect, damage, ship,
        // handoff) issue their own scan rows with their specific contexts when
        // the technician selects them from the case detail page.
        scanContext:   "lookup",
      }).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(
          "[QrScannerClient] Failed to record scan event:",
          err
        );
      });
    }
  }, [phase, caseDoc, rawValue, currentUser.isLoading, currentUser.id, currentUser.name, recordScan]);

  // ── Auto-navigation on successful lookup ───────────────────────────────────
  // When the Convex query resolves to a case document while in the "detected"
  // phase, navigate to the SCAN case detail page using the Convex document ID.
  // Using the _id (not the extracted display identifier) ensures the route
  // matches the /scan/[caseId] segment which passes it to getCaseById.
  useEffect(() => {
    if (phase === "detected" && caseDoc !== undefined && caseDoc !== null) {
      router.push(`/scan/${encodeURIComponent(caseDoc._id)}`);
    }
  }, [phase, caseDoc, router]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleDetected = useCallback((raw: string) => {
    const extracted = extractCaseId(raw);
    setRawValue(raw);          // triggers Convex lookup subscription
    setCaseId(extracted);      // display-only identifier
    setPhase("detected");
  }, []);

  const handleUnavailable = useCallback((reason: string) => {
    setUnavailableReason(reason);
    setPhase("manual");
  }, []);

  const handleScanAgain = useCallback(() => {
    setRawValue(null);    // clears the Convex subscription
    setCaseId(null);
    setPhase("scanning");
    // Reset dedupe so a fresh scan of the same case still records a new row.
    // recordScanEvent appends to immutable history — every physical scan
    // should yield a row, not just the first scan of a given case in a session.
    recordedForCaseRef.current = null;
  }, []);

  /**
   * Explicit "Open Case" navigation — uses the Convex document ID from the
   * resolved case, not the display-only extracted identifier.  Called when
   * the user taps the "Open Case" button in the detected card after lookup.
   * (Auto-navigation via useEffect is the primary path; this is the fallback.)
   */
  const handleOpenCase = useCallback(
    (convexId: string) => {
      router.push(`/scan/${encodeURIComponent(convexId)}`);
    },
    [router]
  );

  const handleManualSubmit = useCallback((value: string) => {
    handleDetected(value);
  }, [handleDetected]);

  const handleSwitchToManual = useCallback(() => {
    setPhase("manual");
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isScanning = phase === "scanning";
  const isDetected = phase === "detected";
  const isManual = phase === "manual";

  return (
    <div className={styles.page}>
      {/* ── Page heading ───────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderRow}>
          <h1 className={styles.pageTitle}>
            {isDetected ? "QR Code Detected" : "Scan QR Code"}
          </h1>

          {/* Manual entry toggle (visible during scanning only) */}
          {isScanning && (
            <button
              type="button"
              className={styles.switchBtn}
              onClick={handleSwitchToManual}
              aria-label="Switch to manual entry"
            >
              {/* Keyboard icon */}
              <svg
                className={styles.switchBtnIcon}
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
              Manual
            </button>
          )}

          {/* Camera toggle (visible during manual entry only) */}
          {isManual && (
            <button
              type="button"
              className={styles.switchBtn}
              onClick={handleScanAgain}
              aria-label="Switch to camera scanner"
            >
              {/* Camera icon */}
              <svg
                className={styles.switchBtnIcon}
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
          )}
        </div>

        {isScanning && (
          <p className={styles.pageSubtitle}>
            Point the camera at the QR code on the equipment case label.
          </p>
        )}
      </div>

      {/* ── Camera viewfinder ───────────────────────────────────────────── */}
      {/*
       * CameraViewfinder is ONLY rendered in the "scanning" phase.
       * If we kept it mounted during "detected" (isDetected), the init
       * useEffect would fire again and call onUnavailable() in browsers
       * without BarcodeDetector support, immediately overwriting the
       * "detected" state with "manual". Unmounting on detection is simpler
       * and avoids this re-mount loop.
       */}
      {isScanning && (
        <div className={styles.viewfinderWrap}>
          <CameraViewfinder
            onDetected={handleDetected}
            onUnavailable={handleUnavailable}
          />
          <p className={styles.viewfinderHint}>
            Hold steady over the QR code until it is captured automatically.
          </p>
        </div>
      )}

      {/* ── Detected value display (with Convex resolution state) ───────── */}
      {isDetected && rawValue && (
        <DetectedValueDisplay
          raw={rawValue}
          caseId={caseId}
          lookupState={lookupState}
          foundCaseLabel={caseDoc != null ? caseDoc.label : undefined}
          foundCaseId={caseDoc != null ? caseDoc._id : undefined}
          onScanAgain={handleScanAgain}
          onOpenCase={handleOpenCase}
        />
      )}

      {/* ── Manual entry fallback ────────────────────────────────────────── */}
      {isManual && (
        <ManualEntryFallback
          onSubmit={handleManualSubmit}
          unavailableReason={unavailableReason}
        />
      )}

      {/* ── Back to home link ────────────────────────────────────────────── */}
      <div className={styles.backRow}>
        <Link
          href="/scan"
          className={styles.backLink}
          aria-label="Back to SCAN home"
        >
          <svg
            className={styles.backIcon}
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
          Back to SCAN home
        </Link>
      </div>
    </div>
  );
}
