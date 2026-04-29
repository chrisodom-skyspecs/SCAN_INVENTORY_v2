/**
 * LabelPageClient — Client Component host for /inventory/cases/[caseId]/label.
 *
 * Owns:
 *   • The reactive Convex subscription to the case document.
 *   • The optional template / mission name resolution for the metadata fields.
 *   • The client-side QR code generation (via usePrintLabel).
 *   • The label size selector (4×6 / 4×3 / 2×3.5).
 *   • The screen-only "back" / "print" / download controls.
 *
 * Why a Client Component?
 *   The CaseLabel + usePrintLabel combination relies on the Web Crypto API and
 *   the `qrcode` library, both of which run in the browser.  Convex hooks
 *   (`useQuery`) also run client-side via the ConvexProvider established in
 *   the root layout.  Wrapping all of that in a single client component keeps
 *   the page boundary clean: page.tsx is a thin server-component shell, and
 *   this file holds all the interactive behaviour.
 *
 * Real-time fidelity
 * ──────────────────
 *   The case document is subscribed via api.cases.getCaseById, so the label
 *   automatically re-renders when the SCAN app advances the case status,
 *   reassigns custody, or changes location — within ~100–300ms of the
 *   underlying mutation, well inside the 2-second SLA.
 *
 * Print isolation
 * ───────────────
 *   The CaseLabel component places `data-case-label-root` on its outermost
 *   wrapper.  CaseLabel.module.css's @media print rules use that attribute to
 *   hide the body, then restore visibility only on the label root and its
 *   descendants.  As a result, calling `window.print()` from this page (via
 *   the screen-only controls) produces a clean single-label printout with no
 *   dashboard chrome.
 *
 * Accessibility
 * ─────────────
 *   • <main> landmark with an aria-label describing the page purpose.
 *   • Loading / not-found / error states use role="status" and role="alert"
 *     so screen readers announce them.
 *   • The size selector is a fieldset with radio buttons (proper grouping).
 *   • Print + back actions are <button> / <a> elements with explicit labels.
 *   • Screen-only controls carry the `screenOnly` class which is hidden in
 *     print media so the printed page contains only the label.
 *
 * Design system compliance
 * ────────────────────────
 *   • All colors come from CSS custom properties — no hex literals.
 *   • Inter Tight for UI text; IBM Plex Mono via the CaseLabel internals.
 *   • StatusPill is rendered inside CaseLabel for the lifecycle status.
 *   • Focus rings via var(--elevation-focus).
 */

"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { CaseLabel, type LabelSize } from "@/components/CaseLabel";
import { usePrintLabel } from "@/hooks/use-print-label";
import type { StatusKind } from "@/components/StatusPill";
import styles from "./LabelPageClient.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Tab definitions for the label size selector. */
const SIZE_TABS: ReadonlyArray<{
  value: LabelSize;
  /** Physical dimension shown in mono on the chip */
  dim: string;
  /** Short descriptive name */
  name: string;
  /** Accessible name for the radio input */
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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LabelPageClientProps {
  /**
   * Convex document ID of the case to render a label for.
   * Sourced from the [caseId] dynamic route segment.
   */
  caseId: string;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

/** Inline back-arrow icon — screen-only, aria-hidden. */
function BackIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06l-3.25-3.25a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Inline printer icon — screen-only, aria-hidden. */
function PrintIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 4.5V2.5A.5.5 0 0 1 3.5 2h9a.5.5 0 0 1 .5.5V4.5H3z" />
      <path
        fillRule="evenodd"
        d="M1 5.5A1.5 1.5 0 0 1 2.5 4h11A1.5 1.5 0 0 1 15 5.5v5a1.5 1.5 0 0 1-1.5 1.5H13v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V12H2.5A1.5 1.5 0 0 1 1 10.5v-5zm3 5v3h8v-3H4zm8.5-3a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders the case-label print page.
 *
 * State machine:
 *   caseDoc === undefined     → loading skeleton
 *   caseDoc === null          → "case not found" alert
 *   caseDoc                   → label preview + print controls
 *
 * QR readiness is independent of caseDoc readiness — the QR code is generated
 * client-side from `caseId` (a route param), so it can begin generating
 * immediately without waiting for the Convex round-trip.
 */
export function LabelPageClient({ caseId }: LabelPageClientProps) {
  // ── Label size selection ────────────────────────────────────────────────────
  const [size, setSize] = React.useState<LabelSize>("4x6");

  // ── QR code generation (client-side) ────────────────────────────────────────
  const { qrState, triggerPrint } = usePrintLabel(caseId);

  // ── Case document subscription ──────────────────────────────────────────────
  // Convex re-evaluates this query whenever the case row changes, so the
  // label metadata stays in sync with the dashboard within ~100–300ms.
  const caseDoc = useQuery(api.cases.getCaseById, {
    caseId: caseId as Id<"cases">,
  });

  // ── Optional template / mission resolution ──────────────────────────────────
  // We only subscribe to the related rows when the case actually references
  // them, otherwise we pass "skip" to avoid an unnecessary subscription.
  const templateName = useTemplateName(caseDoc?.templateId ?? null);
  const missionName = useMissionName(caseDoc?.missionId ?? null);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render: loading state
  // ─────────────────────────────────────────────────────────────────────────────
  if (caseDoc === undefined) {
    return (
      <main className={styles.page} aria-label="Print case label">
        <div className={styles.stateBox} role="status" aria-busy="true">
          <div className={styles.spinner} aria-hidden="true" />
          <p className={styles.stateTitle}>Loading case…</p>
          <p className={styles.stateText}>
            Subscribing to case <span className={styles.mono}>{caseId}</span>.
          </p>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render: not found
  // ─────────────────────────────────────────────────────────────────────────────
  if (caseDoc === null) {
    return (
      <main className={styles.page} aria-label="Print case label">
        <div className={styles.stateBox} role="alert">
          <p className={styles.stateTitle}>Case not found</p>
          <p className={styles.stateText}>
            No case exists with ID{" "}
            <span className={styles.mono}>{caseId}</span>. It may have been
            archived or the link is incorrect.
          </p>
          <Link href="/inventory/cases" className={styles.linkButton}>
            <BackIcon />
            <span>Back to fleet registry</span>
          </Link>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render: ready
  // ─────────────────────────────────────────────────────────────────────────────

  const status = (caseDoc.status ?? "hangar") as StatusKind;

  // QR generation is async; while it's not ready we show a placeholder under
  // the same control surface so the user can still pick a size or go back.
  const qrReady = qrState.status === "ready";
  const qrError = qrState.status === "error";

  return (
    <main className={styles.page} aria-label={`Print label for case ${caseDoc.label}`}>
      {/* ── Screen-only control surface ─────────────────────────────────────── */}
      <header className={`${styles.controls} ${styles.screenOnly}`}>
        <div className={styles.controlsLeft}>
          <Link
            href={`/inventory?case=${encodeURIComponent(caseId)}&panel=1`}
            className={styles.linkButton}
            aria-label={`Back to case detail for ${caseDoc.label}`}
          >
            <BackIcon />
            <span>Back to case</span>
          </Link>

          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>Print Label</p>
            <h1 className={styles.title}>{caseDoc.label}</h1>
          </div>
        </div>

        <div className={styles.controlsRight}>
          <fieldset className={styles.sizeGroup} aria-label="Select label size">
            <legend className={styles.sizeLegend}>Size</legend>
            {SIZE_TABS.map((tab) => {
              const id = `label-size-${tab.value}`;
              const checked = size === tab.value;
              return (
                <label
                  key={tab.value}
                  htmlFor={id}
                  className={`${styles.sizeChip} ${checked ? styles.sizeChipActive : ""}`}
                  aria-label={tab.ariaLabel}
                >
                  <input
                    type="radio"
                    id={id}
                    name="label-size"
                    value={tab.value}
                    checked={checked}
                    onChange={() => setSize(tab.value)}
                    className={styles.sizeRadio}
                  />
                  <span className={styles.sizeName}>{tab.name}</span>
                  <span className={styles.sizeDim}>{tab.dim}</span>
                </label>
              );
            })}
          </fieldset>

          <button
            type="button"
            onClick={triggerPrint}
            className={styles.printButton}
            disabled={!qrReady}
            aria-label={`Print label for case ${caseDoc.label}`}
          >
            <PrintIcon />
            <span>{qrReady ? "Print label" : "Preparing…"}</span>
          </button>
        </div>
      </header>

      {/* ── QR error band (screen-only) ──────────────────────────────────────── */}
      {qrError && (
        <div
          className={`${styles.errorBanner} ${styles.screenOnly}`}
          role="alert"
        >
          <p className={styles.errorTitle}>Could not generate the QR code</p>
          <p className={styles.errorText}>
            {qrState.status === "error"
              ? qrState.error.message
              : "Unknown error"}
          </p>
        </div>
      )}

      {/* ── Label preview / print target ─────────────────────────────────────── */}
      <section
        className={styles.previewArea}
        aria-label="Label preview"
      >
        {qrReady ? (
          <CaseLabel
            data={{
              qrSvg: qrState.svg,
              qrDataUrl: qrState.dataUrl,
              identifier: qrState.identifier,
              payload: qrState.payload,
              label: caseDoc.label,
              status,
              templateName: templateName ?? undefined,
              missionName: missionName ?? undefined,
              assigneeName: caseDoc.assigneeName,
              locationName: caseDoc.locationName,
              createdAt: caseDoc._creationTime
                ? new Date(caseDoc._creationTime)
                : undefined,
              notes: caseDoc.notes,
            }}
            size={size}
            // The page already has its own print button; suppress CaseLabel's.
            showPrintButton={false}
          />
        ) : (
          <div
            className={`${styles.qrLoading} ${styles.screenOnly}`}
            role="status"
            aria-busy={qrState.status === "loading"}
          >
            <div className={styles.spinner} aria-hidden="true" />
            <p className={styles.stateText}>
              {qrState.status === "loading"
                ? "Generating QR code…"
                : qrState.status === "error"
                ? "QR code generation failed."
                : "Initializing…"}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a template ID to its display name via a reactive Convex query.
 * Returns `null` when the template ID is null/undefined or when the template
 * is not found.  Returns `undefined` while the query is still loading.
 */
function useTemplateName(
  templateId: Id<"caseTemplates"> | null | undefined,
): string | null | undefined {
  const template = useQuery(
    api.caseTemplates.getCaseTemplateById,
    templateId
      ? { templateId: templateId as Id<"caseTemplates"> }
      : "skip",
  );
  if (!templateId) return null;
  if (template === undefined) return undefined;
  if (template === null) return null;
  return template.name ?? null;
}

/**
 * Resolve a mission ID to its display name via a reactive Convex query.
 * Returns `null` when the mission ID is null/undefined or when the mission
 * is not found.  Returns `undefined` while the query is still loading.
 */
function useMissionName(
  missionId: Id<"missions"> | null | undefined,
): string | null | undefined {
  const mission = useQuery(
    api.missions.getMissionById,
    missionId
      ? { missionId: missionId as Id<"missions"> }
      : "skip",
  );
  if (!missionId) return null;
  if (mission === undefined) return undefined;
  if (mission === null) return null;
  return mission.name ?? null;
}
