/**
 * CaseSelectionAssociateClient — QR-first, case-selection association flow
 *
 * Sub-AC 3: Case selection/confirmation UI flow for associating a QR code with
 * a case when the target case is NOT known at the start of the flow.
 *
 * This is the reverse-direction counterpart to AssociateQRClient:
 *
 *   AssociateQRClient  (Sub-AC 2):  case ID known → scan QR → confirm → result
 *   CaseSelectionAssociateClient (Sub-AC 3):  scan QR → SELECT case → confirm → result
 *
 * Use case
 * ─────────
 * A technician receives a batch of QR code labels to apply to equipment cases.
 * They scan each label with their phone, then SEARCH for and SELECT the case it
 * should be associated with.  No deep-link or pre-navigation to a specific case
 * is required.  The flow is fully self-contained.
 *
 * Flow steps
 * ──────────
 * 1. "qr"      — Scan QR code via camera (BarcodeDetector) or manual text entry.
 * 2. "select"  — Search the case list by label/location/assignee.  Select one.
 * 3. "confirm" — Review: case card + QR payload + validation (conflict check).
 *                Call associateQRCodeToCase on confirmation.
 * 4. "result"  — Success card or recoverable error with retry options.
 *
 * Case search/filter
 * ──────────────────
 * Subscribes to api.cases.listCases (full fleet) via Convex useQuery.  Filters
 * client-side by the search string against label, locationName, and assigneeName.
 * Up to MAX_CASE_RESULTS (50) cases are shown at once; typing narrows the list.
 * The subscription stays live, so newly-created cases appear automatically.
 *
 * Validation (confirm step)
 * ─────────────────────────
 * Uses validateQrCode to detect:
 *   "available"            → QR is free to associate (happy path).
 *   "mapped_to_this_case"  → QR is already on this case (no-op, shown as info).
 *   "mapped_to_other_case" → QR is already on another case (conflict warning).
 *   "invalid"              → QR payload is empty (should not happen in this flow).
 *
 * validateQrCode is a real-time subscription; it re-evaluates automatically if
 * another client maps the same QR code between capture and this confirmation step.
 *
 * Design system compliance
 * ────────────────────────
 * • All colors via CSS custom properties — no hex literals.
 * • StatusPill for all status rendering.
 * • IBM Plex Mono for QR payloads and case labels.
 * • Inter Tight for all other text.
 * • Touch targets ≥ 44 × 44 px (WCAG 2.5.5).
 * • WCAG AA contrast in both light and dark themes.
 * • prefers-reduced-motion respected in scanner frame and spinner.
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
import { api } from "../../../../convex/_generated/api";
import { useScanCaseDetail } from "../../../hooks/use-scan-queries";
import type { Id } from "../../../../convex/_generated/dataModel";
import { StatusPill } from "../../../components/StatusPill";
import { useKindeUser } from "../../../hooks/use-kinde-user";
import { useAssociateQRCode } from "../../../hooks/use-scan-mutations";
import styles from "./page.module.css";

// BarcodeDetector global types are declared in src/types/barcode-detector.d.ts

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum case results shown in the selection list. */
const MAX_CASE_RESULTS = 50;

// ─── Flow types ───────────────────────────────────────────────────────────────

type FlowStep = "qr" | "select" | "confirm" | "result";
type InputMode = "camera" | "manual";
type ResultState = "success" | "error";

// ─── Case list item shape ─────────────────────────────────────────────────────

interface CaseListItem {
  _id: string;
  label: string;
  status: string;
  locationName?: string;
  assigneeName?: string;
  updatedAt: number;
  qrCode?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateQR(payload: string, maxLen = 48): string {
  if (payload.length <= maxLen) return payload;
  return `${payload.slice(0, maxLen)}…`;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Filter cases by a search string.
 * Matches against label, locationName, and assigneeName (case-insensitive).
 * Returns up to MAX_CASE_RESULTS results.
 */
function filterCases(
  cases: CaseListItem[],
  search: string
): CaseListItem[] {
  const q = search.trim().toLowerCase();
  if (!q) return cases.slice(0, MAX_CASE_RESULTS);
  return cases
    .filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.locationName?.toLowerCase() ?? "").includes(q) ||
        (c.assigneeName?.toLowerCase() ?? "").includes(q)
    )
    .slice(0, MAX_CASE_RESULTS);
}

// ─── Sub-component: Loading skeleton ─────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className={styles.loadingShell} aria-busy="true" aria-label="Loading">
      <div className={styles.skeletonTitle} />
      <div className={styles.skeletonBody} />
      <div className={styles.skeletonBody} style={{ width: "68%" }} />
    </div>
  );
}

// ─── Sub-component: QR Camera Scanner ────────────────────────────────────────

interface QrCameraScannerProps {
  onDetected: (qrCode: string) => void;
  onUnavailable: (reason: string) => void;
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

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (typeof window === "undefined" || !window.BarcodeDetector) {
        onUnavailable("BarcodeDetector API not supported in this browser.");
        return;
      }
      try {
        detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        onUnavailable("Could not initialise QR code detector.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
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

  useEffect(() => {
    if (!cameraReady || paused) return;
    let active = true;
    async function scanFrame() {
      if (!active || paused || !detectorRef.current || !videoRef.current) return;
      if (videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(scanFrame);
        return;
      }
      try {
        const barcodes = await detectorRef.current.detect(videoRef.current);
        if (barcodes.length > 0) {
          const qr = barcodes[0].rawValue;
          if (qr !== lastDetectedRef.current) {
            lastDetectedRef.current = qr;
            onDetected(qr);
          }
        }
      } catch {
        // Transient decode error — continue
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

  if (cameraError) {
    return (
      <div className={styles.cameraError} role="alert">
        <svg className={styles.cameraErrorIcon} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true">
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
      <video ref={videoRef} className={styles.cameraVideo} muted playsInline autoPlay aria-hidden="true" />
      {!cameraReady && (
        <div className={styles.cameraLoading} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Starting camera…</span>
        </div>
      )}
      {cameraReady && (
        <div className={styles.scanReticle} aria-hidden="true">
          <span className={[styles.reticleCorner, styles.reticleTL].join(" ")} />
          <span className={[styles.reticleCorner, styles.reticleTR].join(" ")} />
          <span className={[styles.reticleCorner, styles.reticleBL].join(" ")} />
          <span className={[styles.reticleCorner, styles.reticleBR].join(" ")} />
        </div>
      )}
      {paused && (
        <div className={styles.cameraPaused} aria-label="Scanner paused">
          <svg className={styles.pauseIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
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
  onCameraUnavailable: () => void;
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
      <div className={styles.stepHeader}>
        <div className={styles.stepNumberBadge} aria-label="Step 1 of 4">1</div>
        <div>
          <h2 className={styles.stepTitle}>Scan QR Code</h2>
          <p className={styles.stepSubtitle}>
            Scan the QR label to associate, then select the target case.
          </p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className={styles.modeToggleRow} role="tablist" aria-label="Input method">
        <button
          role="tab"
          aria-selected={inputMode === "camera"}
          className={[styles.modeTab, inputMode === "camera" ? styles.modeTabActive : ""].filter(Boolean).join(" ")}
          onClick={() => inputMode !== "camera" && onModeToggle()}
          type="button"
        >
          <svg className={styles.modeTabIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Camera
        </button>
        <button
          role="tab"
          aria-selected={inputMode === "manual"}
          className={[styles.modeTab, inputMode === "manual" ? styles.modeTabActive : ""].filter(Boolean).join(" ")}
          onClick={() => inputMode !== "manual" && onModeToggle()}
          type="button"
        >
          <svg className={styles.modeTabIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
          </svg>
          Manual Entry
        </button>
      </div>

      {inputMode === "camera" && (
        <div className={styles.cameraContainer} role="tabpanel" aria-label="Camera scanner">
          <QrCameraScanner
            onDetected={onCameraDetected}
            onUnavailable={onCameraUnavailable}
            paused={false}
          />
          <p className={styles.cameraHint}>Hold the camera steady over the QR code on the case label.</p>
        </div>
      )}

      {inputMode === "manual" && (
        <div role="tabpanel" aria-label="Manual QR entry">
          <form onSubmit={handleManualSubmit} noValidate className={styles.manualForm}>
            <div className={styles.fieldGroup}>
              <label htmlFor="manualQRAssociate" className={styles.fieldLabel}>
                QR Code Payload
                <span className={styles.fieldRequired} aria-hidden="true"> *</span>
              </label>
              <textarea
                id="manualQRAssociate"
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
              Next: Select Case
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: Case list row ─────────────────────────────────────────────

interface CaseRowProps {
  caseItem: CaseListItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function CaseRow({ caseItem, isSelected, onSelect }: CaseRowProps) {
  return (
    <button
      type="button"
      className={[
        styles.caseRow,
        isSelected ? styles.caseRowSelected : "",
      ].filter(Boolean).join(" ")}
      onClick={() => onSelect(caseItem._id)}
      aria-pressed={isSelected}
      aria-label={`Select case ${caseItem.label}${caseItem.locationName ? `, location: ${caseItem.locationName}` : ""}`}
      data-testid={`case-row-${caseItem._id}`}
    >
      <div className={styles.caseRowMain}>
        <span className={styles.caseRowLabel}>{caseItem.label}</span>
        <StatusPill kind={caseItem.status as Parameters<typeof StatusPill>[0]["kind"]} />
      </div>
      {(caseItem.locationName || caseItem.assigneeName) && (
        <div className={styles.caseRowMeta}>
          {caseItem.locationName && (
            <span className={styles.caseRowMetaChip}>
              <svg className={styles.caseRowMetaIcon} viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              {caseItem.locationName}
            </span>
          )}
          {caseItem.assigneeName && (
            <span className={styles.caseRowMetaChip}>
              <svg className={styles.caseRowMetaIcon} viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              {caseItem.assigneeName}
            </span>
          )}
          {caseItem.qrCode && (
            <span className={styles.caseRowQRBadge} title="QR code already linked">
              QR linked
            </span>
          )}
        </div>
      )}
      {isSelected && (
        <div className={styles.caseRowCheck} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
    </button>
  );
}

// ─── Sub-component: Step 2 — Case Selection ──────────────────────────────────

interface CaseSelectStepProps {
  scannedQR: string;
  selectedCaseId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelectCase: (id: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}

function CaseSelectStep({
  scannedQR,
  selectedCaseId,
  search,
  onSearchChange,
  onSelectCase,
  onBack,
  onConfirm,
}: CaseSelectStepProps) {
  // Real-time subscription to all cases
  const allCases = useQuery(api.cases.listCases, {});
  const isLoading = allCases === undefined;

  const filteredCases = useMemo(
    () => filterCases((allCases ?? []) as CaseListItem[], search),
    [allCases, search]
  );

  return (
    <div className={styles.step} data-testid="case-select-step">
      <div className={styles.stepHeader}>
        <div className={styles.stepNumberBadge} aria-label="Step 2 of 4">2</div>
        <div>
          <h2 className={styles.stepTitle}>Select Target Case</h2>
          <p className={styles.stepSubtitle}>
            Search and select the case to link this QR code to.
          </p>
        </div>
      </div>

      {/* Scanned QR preview */}
      <div className={styles.qrSummaryChip} aria-label="Scanned QR code">
        <svg className={styles.qrSummaryIcon} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="3" height="3" />
        </svg>
        <span className={styles.qrSummaryValue} title={scannedQR}>
          {truncateQR(scannedQR, 40)}
        </span>
        <button
          type="button"
          className={styles.qrSummaryChange}
          onClick={onBack}
          aria-label="Go back and re-scan the QR code"
        >
          Change
        </button>
      </div>

      {/* Search input */}
      <div className={styles.searchGroup}>
        <label htmlFor="caseSearch" className={styles.searchLabel}>
          Search cases
        </label>
        <div className={styles.searchInputWrap}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="caseSearch"
            type="search"
            className={styles.searchInput}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Case label, location, or assignee…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Search cases by label, location, or assignee"
            data-testid="case-search-input"
          />
          {search && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Case list */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : filteredCases.length === 0 ? (
        <div className={styles.emptyState} role="status">
          <svg className={styles.emptyStateIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <p className={styles.emptyStateTitle}>
            {search ? `No cases match "${search}"` : "No cases found"}
          </p>
          <p className={styles.emptyStateBody}>
            {search
              ? "Try a different search term or clear the filter."
              : "No cases exist yet. Cases can be created in the INVENTORY dashboard."}
          </p>
          {search && (
            <button
              type="button"
              className={styles.emptyStateClear}
              onClick={() => onSearchChange("")}
            >
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <div
          className={styles.caseList}
          role="listbox"
          aria-label="Case list — select a case"
          aria-multiselectable="false"
          data-testid="case-list"
        >
          {filteredCases.map((c) => (
            <CaseRow
              key={c._id}
              caseItem={c}
              isSelected={selectedCaseId === c._id}
              onSelect={onSelectCase}
            />
          ))}
          {(allCases?.length ?? 0) > MAX_CASE_RESULTS && !search && (
            <p className={styles.caseListOverflow}>
              Showing {MAX_CASE_RESULTS} of {allCases?.length} cases — search to narrow results.
            </p>
          )}
        </div>
      )}

      {/* Action row */}
      <div className={styles.actionRow}>
        <button
          type="button"
          className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
          onClick={onBack}
        >
          <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <button
          type="button"
          className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
          onClick={onConfirm}
          disabled={selectedCaseId === null}
          aria-disabled={selectedCaseId === null}
          data-testid="confirm-case-selection-btn"
        >
          {selectedCaseId === null ? (
            "Select a Case"
          ) : (
            <>
              Review Association
              <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Sub-component: QR conflict info banner ───────────────────────────────────

function ConflictBanner({ existingCaseLabel }: { existingCaseLabel: string }) {
  return (
    <div className={styles.conflictBanner} role="alert" aria-live="polite">
      <svg className={styles.bannerIcon} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div>
        <strong className={styles.bannerTitle}>QR code already in use</strong>
        <p className={styles.bannerBody}>
          This QR code is currently mapped to{" "}
          <span className={styles.monoInline}>{existingCaseLabel}</span>.
          Confirming will <strong>reassign</strong> it to the selected case instead.
        </p>
      </div>
    </div>
  );
}

function AlreadyMappedBanner() {
  return (
    <div className={styles.infoBanner} role="status" aria-live="polite">
      <svg className={styles.bannerIcon} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true">
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

// ─── Sub-component: Step 3 — Confirm ─────────────────────────────────────────

interface ConfirmStepProps {
  selectedCaseId: string;
  scannedQR: string;
  onConfirm: () => void;
  onChangeCase: () => void;
  onReScan: () => void;
  isSubmitting: boolean;
  submitError: string | null;
}

function ConfirmStep({
  selectedCaseId,
  scannedQR,
  onConfirm,
  onChangeCase,
  onReScan,
  isSubmitting,
  submitError,
}: ConfirmStepProps) {
  // useScanCaseDetail delegates to useCaseById via the SCAN query layer.
  // Re-evaluates within ~100–300 ms after associateQRCodeToCase patches the row.
  const caseDoc = useScanCaseDetail(selectedCaseId);
  const qrValidation = useQuery(api.qrCodes.validateQrCode, {
    qrCode: scannedQR,
    caseId: selectedCaseId as Id<"cases">,
  });

  const isLoadingCase = caseDoc === undefined;
  const isLoadingValidation = qrValidation === undefined;
  const isLoading = isLoadingCase || isLoadingValidation;

  const isAlreadyMapped = qrValidation?.status === "mapped_to_this_case";
  const hasConflict = qrValidation?.status === "mapped_to_other_case";

  return (
    <div className={styles.step} data-testid="confirm-step">
      <div className={styles.stepHeader}>
        <div className={styles.stepNumberBadge} aria-label="Step 3 of 4">3</div>
        <div>
          <h2 className={styles.stepTitle}>Confirm Association</h2>
          <p className={styles.stepSubtitle}>
            Review the details below before linking this QR code to the case.
          </p>
        </div>
      </div>

      {isLoading && <LoadingSkeleton />}

      {/* Case not found */}
      {!isLoadingCase && caseDoc === null && (
        <div className={styles.stateBox} role="alert">
          <svg className={styles.stateIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true" data-kind="error">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className={styles.stateTitle}>Case not found</p>
          <p className={styles.stateBody}>
            The selected case no longer exists. Please go back and select another.
          </p>
        </div>
      )}

      {!isLoading && caseDoc !== null && caseDoc !== undefined && (
        <>
          {/* Case info card */}
          <section className={styles.caseCard} aria-label="Target case details">
            <div className={styles.caseCardHeader}>
              <h3 className={styles.caseCardTitle}>Selected Case</h3>
              <div className={styles.caseCardActions}>
                <button
                  type="button"
                  className={styles.changeCaseBtn}
                  onClick={onChangeCase}
                  disabled={isSubmitting}
                  aria-label="Change the selected case"
                >
                  Change
                </button>
                <StatusPill kind={caseDoc.status as Parameters<typeof StatusPill>[0]["kind"]} />
              </div>
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
              <svg className={styles.qrIcon} viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="3" height="3" />
                <rect x="18" y="14" width="3" height="3" />
                <rect x="14" y="18" width="3" height="3" />
                <rect x="18" y="18" width="3" height="3" />
              </svg>
              <h3 className={styles.qrPreviewTitle}>QR Code to Associate</h3>
              <button
                type="button"
                className={styles.changeCaseBtn}
                onClick={onReScan}
                disabled={isSubmitting}
                aria-label="Scan a different QR code"
              >
                Rescan
              </button>
            </div>
            <p className={styles.qrPayloadText} title={scannedQR}>
              {truncateQR(scannedQR)}
            </p>
          </section>

          {/* Validation banners */}
          {isAlreadyMapped && <AlreadyMappedBanner />}
          {hasConflict && qrValidation?.conflictingCaseLabel && (
            <ConflictBanner existingCaseLabel={qrValidation.conflictingCaseLabel} />
          )}

          {/* Submit error */}
          {submitError && (
            <div className={styles.errorBanner} role="alert" aria-live="assertive">
              <svg className={styles.bannerIcon} viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
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
              onClick={onChangeCase}
              disabled={isSubmitting}
            >
              <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Change Case
            </button>
            <button
              type="button"
              className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
              onClick={onConfirm}
              disabled={isSubmitting || isAlreadyMapped}
              aria-busy={isSubmitting}
              aria-disabled={isAlreadyMapped}
              data-testid="confirm-association-btn"
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
                  <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true">
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

// ─── Sub-component: Step 4 — Result ──────────────────────────────────────────

interface ResultStepProps {
  resultState: ResultState;
  caseLabel: string;
  caseid: string;
  scannedQR: string;
  wasAlreadyMapped: boolean;
  errorMessage: string | null;
  onStartOver: () => void;
  onRetry: () => void;
}

function ResultStep({
  resultState,
  caseLabel,
  caseid,
  scannedQR,
  wasAlreadyMapped,
  errorMessage,
  onStartOver,
  onRetry,
}: ResultStepProps) {
  const isSuccess = resultState === "success";

  return (
    <div
      className={styles.step}
      data-testid="result-step"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className={styles.stepHeader}>
        <div
          className={[
            styles.stepNumberBadge,
            isSuccess ? styles.stepNumberSuccess : styles.stepNumberError,
          ].join(" ")}
          aria-label="Step 4 of 4"
        >
          4
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
              : "Something went wrong. You can retry or start over."}
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
        data-testid={isSuccess ? "result-success" : "result-error"}
      >
        {isSuccess ? (
          <svg className={styles.resultIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
        ) : (
          <svg className={styles.resultIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
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

        {!isSuccess && errorMessage && (
          <p className={styles.resultErrorMessage}>{errorMessage}</p>
        )}
      </div>

      {/* Action row */}
      <div className={styles.actionRow}>
        {!isSuccess && (
          <button
            type="button"
            className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
            onClick={onRetry}
            data-testid="retry-btn"
          >
            <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-.04-4.07" />
            </svg>
            Try Again
          </button>
        )}
        <button
          type="button"
          className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
          onClick={onStartOver}
          data-testid="start-over-btn"
        >
          Associate Another QR Code
        </button>
        {isSuccess && (
          <Link
            href={`/scan/${caseid}`}
            className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
            aria-label={`View case detail for ${caseLabel}`}
            data-testid="view-case-link"
          >
            <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
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
 * CaseSelectionAssociateClient
 *
 * Orchestrates the 4-step QR-first association flow:
 *
 *   Step "qr"      → QrInputStep          (camera + manual entry)
 *   Step "select"  → CaseSelectStep       (search + list + select)
 *   Step "confirm" → ConfirmStep          (case card + QR + validation)
 *   Step "result"  → ResultStep           (success or error)
 *
 * The flow is designed for the scenario where the technician has a QR label
 * to associate and needs to find the target case — the reverse of
 * AssociateQRClient which starts from a known case.
 */
export function CaseSelectionAssociateClient() {
  const { id: userId, name: userName } = useKindeUser();
  const associateMutation = useAssociateQRCode();

  // ── Flow state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<FlowStep>("qr");
  const [inputMode, setInputMode] = useState<InputMode>("camera");
  const [scannedQR, setScannedQR] = useState<string>("");
  const [manualQR, setManualQR] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCaseLabel, setSelectedCaseLabel] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultState, setResultState] = useState<ResultState>("success");
  const [wasAlreadyMapped, setWasAlreadyMapped] = useState(false);

  // ── Progress steps definition ─────────────────────────────────────────────
  const progressSteps = useMemo(() => [
    { id: "qr",      label: "Scan" },
    { id: "select",  label: "Select" },
    { id: "confirm", label: "Confirm" },
    { id: "result",  label: "Done" },
  ] as const, []);

  const currentStepIndex =
    step === "qr"      ? 0 :
    step === "select"  ? 1 :
    step === "confirm" ? 2 : 3;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCameraDetected = useCallback((qr: string) => {
    setScannedQR(qr);
    setManualQR("");
    setSubmitError(null);
    setStep("select");
  }, []);

  const handleCameraUnavailable = useCallback(() => {
    setInputMode("manual");
  }, []);

  const handleManualSubmit = useCallback((qr: string) => {
    setScannedQR(qr);
    setSubmitError(null);
    setStep("select");
  }, []);

  const handleModeToggle = useCallback(() => {
    setInputMode((m) => (m === "camera" ? "manual" : "camera"));
  }, []);

  const handleSelectCase = useCallback((id: string) => {
    setSelectedCaseId(id);
  }, []);

  const handleConfirmCaseSelection = useCallback(() => {
    if (selectedCaseId) {
      setStep("confirm");
    }
  }, [selectedCaseId]);

  const handleBackToQR = useCallback(() => {
    setScannedQR("");
    setManualQR("");
    setSubmitError(null);
    setStep("qr");
  }, []);

  const handleChangeCase = useCallback(() => {
    setSubmitError(null);
    setStep("select");
  }, []);

  const handleConfirmAssociation = useCallback(async () => {
    if (!scannedQR || !selectedCaseId) return;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await associateMutation({
        qrCode:   scannedQR,
        caseId:   selectedCaseId as Id<"cases">,
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
      setResultState("error");
      setStep("result");
    } finally {
      setIsSubmitting(false);
    }
  }, [scannedQR, selectedCaseId, associateMutation, userId, userName]);

  const handleRetry = useCallback(() => {
    setSubmitError(null);
    setResultState("success");
    setStep("confirm");
  }, []);

  const handleStartOver = useCallback(() => {
    setScannedQR("");
    setManualQR("");
    setSearch("");
    setSelectedCaseId(null);
    setSelectedCaseLabel("");
    setSubmitError(null);
    setResultState("success");
    setWasAlreadyMapped(false);
    setStep("qr");
  }, []);

  // Track case label for the result step (read from the confirm-step subscription)
  // We use a separate state to avoid re-subscribing after navigating to "result".
  const caseDocForLabel = useQuery(
    api.cases.getCaseById,
    selectedCaseId ? { caseId: selectedCaseId as Id<"cases"> } : "skip"
  );
  useEffect(() => {
    if (caseDocForLabel && caseDocForLabel.label) {
      setSelectedCaseLabel(caseDocForLabel.label);
    }
  }, [caseDocForLabel]);

  const activeQR = scannedQR || manualQR;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Associate QR Code</h1>
        <p className={styles.pageSubheading}>
          Scan a QR label and link it to an equipment case.
        </p>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      {/* ── Progress track ─────────────────────────────────────────────── */}
      <nav className={styles.progressTrack} aria-label="Association flow progress">
        {progressSteps.map(({ id, label }, idx) => {
          const isDone   = idx < currentStepIndex;
          const isActive = idx === currentStepIndex;
          return (
            <div key={id} className={styles.progressStep}>
              <div
                className={[
                  styles.progressDot,
                  isDone   ? styles.progressDotDone   : "",
                  isActive ? styles.progressDotActive : "",
                ].filter(Boolean).join(" ")}
                aria-current={isActive ? "step" : undefined}
              >
                {isDone ? (
                  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true" className={styles.progressDotCheck}>
                    <polyline points="2 5 4 7 8 3" />
                  </svg>
                ) : (
                  <span aria-hidden="true">{idx + 1}</span>
                )}
              </div>
              <span className={[
                styles.progressLabel,
                isActive ? styles.progressLabelActive : "",
                isDone   ? styles.progressLabelDone   : "",
              ].filter(Boolean).join(" ")}>
                {label}
              </span>
              {idx < progressSteps.length - 1 && (
                <div
                  className={[styles.progressLine, isDone ? styles.progressLineDone : ""].filter(Boolean).join(" ")}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </nav>

      <div className={styles.divider} aria-hidden="true" />

      {/* ── Step content ───────────────────────────────────────────────── */}
      {step === "qr" && (
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

      {step === "select" && (
        <CaseSelectStep
          scannedQR={activeQR}
          selectedCaseId={selectedCaseId}
          search={search}
          onSearchChange={setSearch}
          onSelectCase={handleSelectCase}
          onBack={handleBackToQR}
          onConfirm={handleConfirmCaseSelection}
        />
      )}

      {step === "confirm" && selectedCaseId && (
        <ConfirmStep
          selectedCaseId={selectedCaseId}
          scannedQR={activeQR}
          onConfirm={handleConfirmAssociation}
          onChangeCase={handleChangeCase}
          onReScan={handleBackToQR}
          isSubmitting={isSubmitting}
          submitError={submitError}
        />
      )}

      {step === "result" && (
        <ResultStep
          resultState={resultState}
          caseLabel={selectedCaseLabel}
          caseid={selectedCaseId ?? ""}
          scannedQR={activeQR}
          wasAlreadyMapped={wasAlreadyMapped}
          errorMessage={submitError}
          onStartOver={handleStartOver}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
}
