/**
 * LabelManagementPanel — QR label management for equipment cases.
 *
 * A self-contained panel with two modes:
 *
 *   1. Generate New Label (mode: "generate")
 *      ─ Calls `api.qrCodes.generateQRCodeForCase` mutation.
 *      ─ Renders the resulting QR code as an inline SVG.
 *      ─ Supports optional force-regenerate toggle when a QR code already exists.
 *      ─ Loading → success (QR display) → error (with retry) states.
 *
 *   2. Associate Existing Label (mode: "associate")
 *      ─ Renders a text input for the QR code payload string.
 *      ─ Real-time validation via `api.qrCodes.validateQrCode` (subscribed query).
 *      ─ Calls `api.qrCodes.associateQRCodeToCase` on submit.
 *      ─ Loading → success (confirmation) → error (with retry) states.
 *
 * Design system compliance
 * ────────────────────────
 *   • All colors via CSS custom properties — no hex literals.
 *   • Inter Tight for UI text; IBM Plex Mono for QR payloads and identifiers.
 *   • StatusPill is NOT used here (no case status context), but the panel follows
 *     the same token + typography conventions as StatusPill consumers.
 *   • WCAG AA contrast in both light and dark themes.
 *   • Focus-visible rings on all interactive elements.
 *   • Touch targets ≥ 44 × 44 px.
 *   • prefers-reduced-motion respected (spinner disabled).
 *
 * Real-time fidelity
 * ──────────────────
 * Both mutations patch `cases.qrCode` and `cases.updatedAt`.  Convex
 * automatically re-evaluates every subscribed query that reads those fields
 * and pushes diffs to connected clients within ~100–300 ms — satisfying the
 * ≤ 2-second real-time fidelity requirement on the INVENTORY dashboard.
 *
 * Usage (INVENTORY dashboard case detail panel):
 * ```tsx
 *   <LabelManagementPanel
 *     caseId={caseDoc._id}
 *     caseLabel={caseDoc.label}
 *     hasExistingQrCode={!!caseDoc.qrCode}
 *     onGenerated={(result) => console.log("Generated:", result.qrCode)}
 *     onAssociated={(result) => console.log("Associated:", result.qrCode)}
 *   />
 * ```
 */

"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import QRCode from "qrcode";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useKindeUser } from "@/hooks/use-kinde-user";
import type {
  GenerateQRCodeResult,
  AssociateQRCodeResult,
} from "@/types/scan-results";
import styles from "./LabelManagementPanel.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Which flow is currently active. */
type PanelMode = "generate" | "associate";

/** Internal flow state for the generate flow. */
type GenerateFlowState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; result: GenerateQRCodeResult; qrSvg: string }
  | { phase: "error"; message: string };

/** Internal flow state for the associate flow. */
type AssociateFlowState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; result: AssociateQRCodeResult; qrSvg: string }
  | { phase: "error"; message: string };

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LabelManagementPanelProps {
  /** Convex document ID of the target case. */
  caseId: string;

  /**
   * Human-readable display label for context in the panel header.
   * E.g. "CASE-001". Optional — omit when the case label is shown elsewhere.
   */
  caseLabel?: string;

  /**
   * Whether a QR code is already linked to this case.
   * When `true`, the generate flow shows a "Force Regenerate" toggle and
   * the generate button label changes to "Regenerate QR Code".
   */
  hasExistingQrCode?: boolean;

  /**
   * Called after `generateQRCodeForCase` completes successfully.
   * Receives the full `GenerateQRCodeResult` from the server.
   */
  onGenerated?: (result: GenerateQRCodeResult) => void;

  /**
   * Called after `associateQRCodeToCase` completes successfully.
   * Receives the full `AssociateQRCodeResult` from the server.
   */
  onAssociated?: (result: AssociateQRCodeResult) => void;

  /** Additional className for the panel root element. */
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the base URL for QR payload generation.
 * Falls back from NEXT_PUBLIC_SCAN_APP_URL → "/scan".
 */
function resolveScanBaseUrl(): string {
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_SCAN_APP_URL
  ) {
    return process.env.NEXT_PUBLIC_SCAN_APP_URL;
  }
  return "/scan";
}

/**
 * Generate an inline SVG string from a QR code URL payload using the
 * qrcode library (same library used in usePrintLabel).
 *
 * Uses error-correction level "H" (30%) — labels may be partially obscured.
 */
async function buildQrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 2,
  });
}

/**
 * Truncate a long QR payload for display.
 * Preserves scheme + authority; truncates path/query params.
 */
function truncatePayload(payload: string, maxLen = 72): string {
  if (payload.length <= maxLen) return payload;
  return `${payload.slice(0, maxLen)}…`;
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

function QrIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="3" height="3" />
      <rect x="18" y="14" width="3" height="3" />
      <rect x="14" y="18" width="3" height="3" />
      <rect x="18" y="18" width="3" height="3" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function PlusCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function AlertCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

// ─── Sub-component: Generate flow ─────────────────────────────────────────────

interface GenerateFlowProps {
  caseId: string;
  hasExistingQrCode: boolean;
  onGenerated?: (result: GenerateQRCodeResult) => void;
}

function GenerateFlow({
  caseId,
  hasExistingQrCode,
  onGenerated,
}: GenerateFlowProps) {
  // ── Auth ──────────────────────────────────────────────────────────
  const { id: userId, name: userName, isLoading: authLoading } = useKindeUser({
    fallbackName: "Operator",
  });

  // ── Convex mutation ───────────────────────────────────────────────
  const generateMutation = useMutation(api.qrCodes.generateQRCodeForCase);

  // ── Local state ───────────────────────────────────────────────────
  const [flowState, setFlowState] = React.useState<GenerateFlowState>({
    phase: "idle",
  });
  const [forceRegenerate, setForceRegenerate] = React.useState(false);

  // ── Generate handler ──────────────────────────────────────────────
  const handleGenerate = React.useCallback(async () => {
    if (authLoading || !userId) return;

    setFlowState({ phase: "loading" });

    try {
      const result = await generateMutation({
        caseId: caseId as Id<"cases">,
        userId,
        userName,
        baseUrl: resolveScanBaseUrl(),
        forceRegenerate: hasExistingQrCode ? forceRegenerate : false,
      });

      // Generate QR SVG from the returned payload URL
      const qrSvg = await buildQrSvg(result.qrCode);

      setFlowState({ phase: "success", result, qrSvg });
      onGenerated?.(result);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to generate QR code. Please try again.";
      setFlowState({ phase: "error", message });
    }
  }, [
    authLoading,
    userId,
    userName,
    caseId,
    generateMutation,
    hasExistingQrCode,
    forceRegenerate,
    onGenerated,
  ]);

  // ── Reset handler ─────────────────────────────────────────────────
  const handleReset = React.useCallback(() => {
    setFlowState({ phase: "idle" });
    setForceRegenerate(false);
  }, []);

  // ── Render: loading ───────────────────────────────────────────────
  if (flowState.phase === "loading") {
    return (
      <div
        className={styles.loadingState}
        role="status"
        aria-live="polite"
        aria-label="Generating QR code"
        data-testid="generate-loading"
      >
        <span className={styles.spinner} aria-hidden="true" />
        <span>Generating QR code…</span>
      </div>
    );
  }

  // ── Render: success ───────────────────────────────────────────────
  if (flowState.phase === "success") {
    const { result, qrSvg } = flowState;
    return (
      <div className={styles.successState} data-testid="generate-success">
        {/* Success banner */}
        <div
          className={styles.successBanner}
          role="status"
          aria-live="polite"
        >
          <CheckCircleIcon className={styles.successBannerIcon} />
          <p className={styles.successBannerText}>
            {result.wasRegenerated
              ? "QR code regenerated successfully. The previous label is now invalid."
              : "QR code generated successfully."}
          </p>
        </div>

        {/* QR code display */}
        <div className={styles.qrDisplay} aria-label="Generated QR code">
          <div
            className={styles.qrSvgWrapper}
            // SVG from the qrcode library is safe — no external refs or scripts.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
            role="img"
            aria-label={`QR code for case ${caseId}`}
          />
          <span className={styles.qrPayloadLabel}>QR Payload</span>
          <code className={styles.qrPayloadValue} title={result.qrCode}>
            {truncatePayload(result.qrCode)}
          </code>
          {result.wasRegenerated && (
            <p className={styles.qrRegeneratedNote}>
              Previous QR code:{" "}
              {result.previousQrCode
                ? truncatePayload(result.previousQrCode, 48)
                : "—"}
            </p>
          )}
        </div>

        {/* Start over */}
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.resetLink}
            onClick={handleReset}
            data-testid="generate-reset"
          >
            Generate another
          </button>
        </div>
      </div>
    );
  }

  // ── Render: error ─────────────────────────────────────────────────
  if (flowState.phase === "error") {
    return (
      <div className={styles.successState} data-testid="generate-error">
        <div className={styles.errorBanner} role="alert" aria-live="assertive">
          <AlertCircleIcon className={styles.errorBannerIcon} />
          <div className={styles.errorBannerBody}>
            <p className={styles.errorBannerTitle}>QR code generation failed</p>
            <p className={styles.errorBannerDetail}>{flowState.message}</p>
          </div>
        </div>
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleGenerate}
            data-testid="generate-retry"
            disabled={authLoading}
          >
            <RefreshIcon className={styles.btnIcon} />
            Retry
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleReset}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Render: idle (default) ────────────────────────────────────────
  const generateLabel = hasExistingQrCode
    ? "Regenerate QR Code"
    : "Generate QR Code";

  return (
    <div data-testid="generate-idle">
      <p className={styles.generateDescription}>
        {hasExistingQrCode
          ? "Generate a new unique QR code for this case. The current QR code will be replaced — any printed labels will become invalid."
          : "Generate a unique QR code label for this case. The system will create a URL-encoded payload that links back to this case in the SCAN app."}
      </p>

      {/* Force-regenerate toggle — only shown when a QR code exists */}
      {hasExistingQrCode && (
        <div className={styles.generateActions} style={{ marginTop: "0.75rem" }}>
          <label className={styles.forceRegenerateLabel}>
            <input
              type="checkbox"
              className={styles.forceRegenerateCheckbox}
              checked={forceRegenerate}
              onChange={(e) => setForceRegenerate(e.target.checked)}
              data-testid="force-regenerate-checkbox"
            />
            Invalidate existing label and generate a new one
          </label>
        </div>
      )}

      <div className={styles.generateActions} style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={handleGenerate}
          disabled={authLoading || !userId}
          aria-busy={false}
          data-testid="generate-submit"
        >
          <PlusCircleIcon className={styles.btnIcon} />
          {generateLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Sub-component: Associate flow ────────────────────────────────────────────

interface AssociateFlowProps {
  caseId: string;
  onAssociated?: (result: AssociateQRCodeResult) => void;
}

function AssociateFlow({ caseId, onAssociated }: AssociateFlowProps) {
  // ── Auth ──────────────────────────────────────────────────────────
  const { id: userId, name: userName, isLoading: authLoading } = useKindeUser({
    fallbackName: "Operator",
  });

  // ── Convex mutation ───────────────────────────────────────────────
  const associateMutation = useMutation(api.qrCodes.associateQRCodeToCase);

  // ── Local state ───────────────────────────────────────────────────
  const [flowState, setFlowState] = React.useState<AssociateFlowState>({
    phase: "idle",
  });
  const [inputValue, setInputValue] = React.useState("");

  // ── Real-time QR validation (subscribed query) ────────────────────
  // Subscribe when the user has typed something. Convex re-evaluates
  // automatically if another client maps the same code concurrently.
  const trimmedInput = inputValue.trim();
  const validationResult = useQuery(
    api.qrCodes.validateQrCode,
    trimmedInput.length > 0 && caseId
      ? { qrCode: trimmedInput, caseId: caseId as Id<"cases"> }
      : "skip"
  );

  // ── Submit handler ────────────────────────────────────────────────
  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const qrCode = inputValue.trim();
      if (!qrCode || authLoading || !userId) return;

      setFlowState({ phase: "loading" });

      try {
        const result = await associateMutation({
          qrCode,
          caseId: caseId as Id<"cases">,
          userId,
          userName,
        });

        // Generate QR SVG from the associated payload URL
        const qrSvg = await buildQrSvg(result.qrCode);

        setFlowState({ phase: "success", result, qrSvg });
        onAssociated?.(result);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to associate QR code. Please try again.";
        setFlowState({ phase: "error", message });
      }
    },
    [inputValue, authLoading, userId, userName, caseId, associateMutation, onAssociated]
  );

  // ── Reset handler ─────────────────────────────────────────────────
  const handleReset = React.useCallback(() => {
    setFlowState({ phase: "idle" });
    setInputValue("");
  }, []);

  // ── Render: loading ───────────────────────────────────────────────
  if (flowState.phase === "loading") {
    return (
      <div
        className={styles.loadingState}
        role="status"
        aria-live="polite"
        aria-label="Associating QR code"
        data-testid="associate-loading"
      >
        <span className={styles.spinner} aria-hidden="true" />
        <span>Associating QR code…</span>
      </div>
    );
  }

  // ── Render: success ───────────────────────────────────────────────
  if (flowState.phase === "success") {
    const { result, qrSvg } = flowState;
    return (
      <div className={styles.successState} data-testid="associate-success">
        {/* Success banner */}
        <div
          className={styles.successBanner}
          role="status"
          aria-live="polite"
        >
          <CheckCircleIcon className={styles.successBannerIcon} />
          <p className={styles.successBannerText}>
            {result.wasAlreadyMapped
              ? "This QR code is already linked to this case — no change needed."
              : "QR code successfully associated with this case."}
          </p>
        </div>

        {/* QR code display */}
        <div className={styles.qrDisplay} aria-label="Associated QR code">
          <div
            className={styles.qrSvgWrapper}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
            role="img"
            aria-label={`QR code for case ${caseId}`}
          />
          <span className={styles.qrPayloadLabel}>QR Payload</span>
          <code className={styles.qrPayloadValue} title={result.qrCode}>
            {truncatePayload(result.qrCode)}
          </code>
        </div>

        {/* Associate another */}
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.resetLink}
            onClick={handleReset}
            data-testid="associate-reset"
          >
            Associate a different code
          </button>
        </div>
      </div>
    );
  }

  // ── Render: error ─────────────────────────────────────────────────
  if (flowState.phase === "error") {
    return (
      <div className={styles.successState} data-testid="associate-error">
        <div className={styles.errorBanner} role="alert" aria-live="assertive">
          <AlertCircleIcon className={styles.errorBannerIcon} />
          <div className={styles.errorBannerBody}>
            <p className={styles.errorBannerTitle}>Association failed</p>
            <p className={styles.errorBannerDetail}>{flowState.message}</p>
          </div>
        </div>
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleReset}
            data-testid="associate-back"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Derive validation badge info ──────────────────────────────────
  let validationBadge: React.ReactNode = null;
  if (trimmedInput.length > 0 && validationResult !== undefined) {
    if (validationResult.status === "available") {
      validationBadge = (
        <span
          className={[styles.validationBadge, styles.validationBadgeAvailable].join(" ")}
          role="status"
          aria-label="QR code is available"
        >
          <CheckCircleIcon className={styles.validationIcon} />
          Available
        </span>
      );
    } else if (validationResult.status === "mapped_to_this_case") {
      validationBadge = (
        <span
          className={[styles.validationBadge, styles.validationBadgeMapped].join(" ")}
          role="status"
          aria-label="Already linked to this case"
        >
          <CheckCircleIcon className={styles.validationIcon} />
          Already linked
        </span>
      );
    } else if (validationResult.status === "mapped_to_other_case") {
      validationBadge = (
        <span
          className={[styles.validationBadge, styles.validationBadgeConflict].join(" ")}
          role="alert"
          aria-label={`In use on case ${validationResult.conflictingCaseLabel ?? "another case"}`}
        >
          <AlertCircleIcon className={styles.validationIcon} />
          In use on{" "}
          {validationResult.conflictingCaseLabel ?? "another case"}
        </span>
      );
    } else if (validationResult.status === "invalid") {
      validationBadge = (
        <span
          className={[styles.validationBadge, styles.validationBadgeInvalid].join(" ")}
          role="alert"
          aria-label="Invalid QR code"
        >
          <AlertCircleIcon className={styles.validationIcon} />
          {validationResult.reason ?? "Invalid"}
        </span>
      );
    }
  }

  // Disable submit for these conditions:
  const isSubmitDisabled =
    authLoading ||
    !userId ||
    !trimmedInput ||
    validationResult?.status === "invalid" ||
    validationResult?.status === "mapped_to_this_case";

  // ── Render: idle (form) ───────────────────────────────────────────
  return (
    <form
      className={styles.associateForm}
      onSubmit={handleSubmit}
      noValidate
      data-testid="associate-form"
    >
      <div className={styles.fieldGroup}>
        <label htmlFor="lmp-qr-input" className={styles.fieldLabel}>
          QR Code Payload
          <span className={styles.fieldRequired} aria-hidden="true"> *</span>
        </label>
        <textarea
          id="lmp-qr-input"
          className={styles.fieldInput}
          rows={4}
          placeholder="Paste or type the QR payload string (e.g. https://scan.skyspecs.com/case/…)"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          aria-required="true"
          aria-describedby="lmp-qr-hint"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          disabled={false}
          data-testid="associate-input"
        />
        <span id="lmp-qr-hint" className={styles.fieldHint}>
          The QR payload is the URL or string encoded inside the physical case label.
          Scan with a camera or paste from a QR reader.
        </span>

        {/* Real-time validation badge */}
        {validationBadge && (
          <div style={{ marginTop: "0.25rem" }}>{validationBadge}</div>
        )}
      </div>

      <div className={styles.actionRow}>
        <button
          type="submit"
          className={styles.btnPrimary}
          disabled={isSubmitDisabled}
          aria-busy={false}
          data-testid="associate-submit"
        >
          <LinkIcon className={styles.btnIcon} />
          Associate QR Code
        </button>
      </div>
    </form>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * LabelManagementPanel
 *
 * Self-contained panel for QR label management.
 *
 * Renders either the generate-new-label flow or the associate-existing flow
 * depending on the active mode tab. Both flows share the same panel shell
 * (header, mode toggle bar, content area).
 */
export function LabelManagementPanel({
  caseId,
  caseLabel,
  hasExistingQrCode = false,
  onGenerated,
  onAssociated,
  className,
}: LabelManagementPanelProps) {
  const [mode, setMode] = React.useState<PanelMode>("generate");

  return (
    <div
      className={[styles.panel, className].filter(Boolean).join(" ")}
      data-testid="label-management-panel"
    >
      {/* ── Panel header ─────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <QrIcon className={styles.headerIcon} />
          <h2 className={styles.headerTitle}>
            {caseLabel ? `Label — ${caseLabel}` : "QR Label Management"}
          </h2>
        </div>
      </header>

      {/* ── Mode toggle ──────────────────────────────────────────── */}
      <div
        className={styles.modeBar}
        role="group"
        aria-label="Label management mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "generate"}
          className={[
            styles.modeTab,
            mode === "generate" ? styles.modeTabActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setMode("generate")}
          data-testid="mode-tab-generate"
        >
          <PlusCircleIcon className={styles.modeTabIcon} />
          Generate New
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "associate"}
          className={[
            styles.modeTab,
            mode === "associate" ? styles.modeTabActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setMode("associate")}
          data-testid="mode-tab-associate"
        >
          <LinkIcon className={styles.modeTabIcon} />
          Associate Existing
        </button>
      </div>

      {/* ── Flow content ─────────────────────────────────────────── */}
      <div className={styles.content}>
        {mode === "generate" ? (
          <>
            <div>
              <h3 className={styles.sectionTitle}>
                {hasExistingQrCode ? "Regenerate QR Code" : "Generate New QR Code"}
              </h3>
              <p className={styles.sectionSubtitle}>
                {hasExistingQrCode
                  ? "Create a new system-generated QR code for this case. Use this when the physical label is lost or damaged."
                  : "Create a system-generated QR code for this case. A unique URL will be generated and stored."}
              </p>
            </div>

            <hr className={styles.divider} aria-hidden="true" />

            <GenerateFlow
              caseId={caseId}
              hasExistingQrCode={hasExistingQrCode}
              onGenerated={onGenerated}
            />
          </>
        ) : (
          <>
            <div>
              <h3 className={styles.sectionTitle}>Associate Physical Label</h3>
              <p className={styles.sectionSubtitle}>
                Link a pre-printed physical QR code label to this case. Scan the
                label with a QR reader or paste the payload string.
              </p>
            </div>

            <hr className={styles.divider} aria-hidden="true" />

            <AssociateFlow
              caseId={caseId}
              onAssociated={onAssociated}
            />
          </>
        )}
      </div>
    </div>
  );
}
