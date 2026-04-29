/**
 * BatchLabelPageClient — Client Component host for /inventory/cases/labels.
 *
 * Renders one printable CaseLabel per case ID supplied in the URL query
 * string, stacked vertically on screen and emitted as one printer-page per
 * label when the user invokes the browser print dialog.
 *
 * URL formats accepted (combined, trimmed, deduplicated, order-preserving):
 *   1. Comma-separated:   ?ids=id1,id2,id3
 *   2. Repeated key:      ?id=id1&id=id2&id=id3
 *   Both forms can be mixed in a single URL.
 *
 * Why per-tile components?
 * ────────────────────────
 *   React hooks cannot be invoked inside a loop in a single component, so
 *   each per-case Convex subscription and per-case QR generation is owned
 *   by its own `<BatchLabelTile>` instance.  This also means a slow QR
 *   generation for one case never blocks the others — each tile renders
 *   independently as soon as its data is ready.
 *
 * Print isolation
 * ───────────────
 *   The shared CaseLabel.module.css file already declares
 *
 *     [data-case-label-root]              { break-after: page; … }
 *     [data-case-label-root]:last-of-type { break-after: auto; }
 *
 *   so stacking N `<CaseLabel>` components yields N printer pages with no
 *   trailing blank page.  This client component therefore does no bespoke
 *   print CSS — it simply renders the labels in DOM order and lets the
 *   shared rules apply.
 *
 *   The page-level controls (header, size selector, print button, error
 *   banners, info messages) are wrapped in a `.screenOnly` class which is
 *   `display: none` under `@media print`, so the printed output contains
 *   only the label roots and their descendants.
 *
 * Real-time fidelity
 * ──────────────────
 *   Each tile subscribes to its case via `api.cases.getCaseById`, so labels
 *   stay in sync with mutations from the SCAN app within ~100–300 ms — well
 *   inside the 2-second SLA.
 *
 * Accessibility
 * ─────────────
 *   • <main> landmark with an aria-label describing the page purpose.
 *   • State boxes use role="status" / role="alert" so screen readers
 *     announce loading / error transitions.
 *   • The size selector is a fieldset with radio buttons (proper grouping).
 *   • Print + back actions are <button> / <a> elements with explicit labels.
 *   • Each label tile is wrapped in a <section> with an aria-label naming
 *     the case being rendered, so a screen reader can navigate between them.
 *   • The screen-only controls carry the `screenOnly` class which is hidden
 *     in print media so the printed page contains only the labels.
 */

"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CaseLabel, type LabelSize } from "@/components/CaseLabel";
import { usePrintLabel } from "@/hooks/use-print-label";
import type { StatusKind } from "@/components/StatusPill";
import styles from "./BatchLabelPageClient.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Hard upper bound on the number of cases we will batch-render in a single
 * request.  Beyond this, the browser print preview tends to stall under the
 * weight of N synchronous QR generations and N concurrent Convex
 * subscriptions, so we surface a helpful error rather than silently grinding.
 */
const MAX_BATCH_SIZE = 100;

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse the case-IDs list out of the URL query string.
 *
 * Both `?ids=id1,id2` and `?id=id1&id=id2` forms are accepted, can be
 * combined, are trimmed, and are deduplicated while preserving the order
 * of first appearance.  Empty or whitespace-only entries are dropped.
 *
 * Exported so the unit tests can verify the parser without rendering the
 * full client component.
 */
export function parseCaseIds(searchParams: URLSearchParams): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const consume = (raw: string | null | undefined) => {
    if (!raw) return;
    for (const piece of raw.split(",")) {
      const trimmed = piece.trim();
      if (trimmed.length === 0) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
  };

  // ?ids=id1,id2,id3
  for (const value of searchParams.getAll("ids")) {
    consume(value);
  }
  // ?id=id1&id=id2
  for (const value of searchParams.getAll("id")) {
    consume(value);
  }

  return result;
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

// ─── Component: Page ──────────────────────────────────────────────────────────

/**
 * BatchLabelPageClient — read case IDs from the URL and render one CaseLabel
 * per ID with shared print controls.
 *
 * State machine:
 *   ids.length === 0           → empty / "no cases selected" message
 *   ids.length > MAX_BATCH_SIZE → "too many cases" alert
 *   otherwise                  → controls header + N <BatchLabelTile>s
 */
export function BatchLabelPageClient() {
  // ── Parse case IDs from URL ─────────────────────────────────────────────────
  const searchParams = useSearchParams();
  const caseIds = React.useMemo(() => {
    // useSearchParams may be `null` during SSR.  Treat that as no IDs.
    if (!searchParams) return [] as string[];
    // ReadonlyURLSearchParams supports the same lookup API as URLSearchParams.
    return parseCaseIds(searchParams as unknown as URLSearchParams);
  }, [searchParams]);

  // ── Label size selection (shared across every tile) ─────────────────────────
  const [size, setSize] = React.useState<LabelSize>("4x6");

  // ─────────────────────────────────────────────────────────────────────────────
  // Render: empty state
  // ─────────────────────────────────────────────────────────────────────────────
  if (caseIds.length === 0) {
    return (
      <main
        className={styles.page}
        aria-label="Print case labels (batch)"
      >
        <div className={styles.stateBox} role="status">
          <p className={styles.stateTitle}>No cases selected</p>
          <p className={styles.stateText}>
            Add case IDs to the URL to render printable labels for them. For
            example,{" "}
            <span className={styles.mono}>
              /inventory/cases/labels?ids=&lt;id1&gt;,&lt;id2&gt;
            </span>
            .
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
  // Render: too-many state
  // ─────────────────────────────────────────────────────────────────────────────
  if (caseIds.length > MAX_BATCH_SIZE) {
    return (
      <main
        className={styles.page}
        aria-label="Print case labels (batch)"
      >
        <div className={styles.stateBox} role="alert">
          <p className={styles.stateTitle}>Too many cases for one batch</p>
          <p className={styles.stateText}>
            The batch print page accepts a maximum of{" "}
            <span className={styles.mono}>{MAX_BATCH_SIZE}</span> case IDs in
            a single request. You supplied{" "}
            <span className={styles.mono}>{caseIds.length}</span>. Split the
            list into smaller batches and try again.
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
  return (
    <main
      className={styles.page}
      aria-label={`Print labels for ${caseIds.length} cases`}
    >
      {/* ── Screen-only control surface ─────────────────────────────────────── */}
      <header className={`${styles.controls} ${styles.screenOnly}`}>
        <div className={styles.controlsLeft}>
          <Link
            href="/inventory/cases"
            className={styles.linkButton}
            aria-label="Back to fleet registry"
          >
            <BackIcon />
            <span>Back to cases</span>
          </Link>

          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>Print Labels — Batch</p>
            <h1 className={styles.title}>
              {caseIds.length} {caseIds.length === 1 ? "case" : "cases"}
            </h1>
          </div>
        </div>

        <div className={styles.controlsRight}>
          <fieldset className={styles.sizeGroup} aria-label="Select label size">
            <legend className={styles.sizeLegend}>Size</legend>
            {SIZE_TABS.map((tab) => {
              const id = `batch-label-size-${tab.value}`;
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
                    name="batch-label-size"
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
            onClick={() => window.print()}
            className={styles.printButton}
            aria-label={`Print all ${caseIds.length} labels`}
            data-testid="batch-print-button"
          >
            <PrintIcon />
            <span>Print all</span>
          </button>
        </div>
      </header>

      {/* ── Helper hint (screen only) ───────────────────────────────────────── */}
      <p
        className={`${styles.hint} ${styles.screenOnly}`}
        aria-hidden="false"
      >
        Each case prints on its own page. Labels render here at physical
        dimensions; the order on paper matches the order on screen.
      </p>

      {/* ── Stacked label preview / print target ─────────────────────────────── */}
      <section
        className={styles.previewArea}
        aria-label="Batch label preview"
        data-testid="batch-label-preview"
      >
        {caseIds.map((caseId, idx) => (
          <BatchLabelTile
            key={caseId}
            caseId={caseId}
            size={size}
            position={idx + 1}
            total={caseIds.length}
          />
        ))}
      </section>
    </main>
  );
}

// ─── Component: per-case tile ─────────────────────────────────────────────────

interface BatchLabelTileProps {
  /** Convex document ID of the case to render a label for. */
  caseId: string;
  /** Currently-selected physical label size (shared across tiles). */
  size: LabelSize;
  /** 1-indexed position of this label in the batch (for accessibility). */
  position: number;
  /** Total number of labels in the batch (for accessibility). */
  total: number;
}

/**
 * One label in the batch.
 *
 * Owns its own Convex subscription and its own client-side QR generation,
 * so a slow query for one case never blocks rendering of the others.
 *
 * Render states:
 *   caseDoc === undefined → loading skeleton tile (screen-only)
 *   caseDoc === null      → "case not found" tile (screen-only)
 *   QR not ready          → loading placeholder tile (screen-only)
 *   ready                 → CaseLabel preview (screen + print target)
 *
 * The screen-only tiles are wrapped in `.screenOnly` so they never appear
 * on the printed sheet — only successfully-rendered labels print.
 */
export function BatchLabelTile({
  caseId,
  size,
  position,
  total,
}: BatchLabelTileProps) {
  // ── Per-tile QR generation (client-side) ────────────────────────────────────
  const { qrState } = usePrintLabel(caseId);

  // ── Per-tile case document subscription ─────────────────────────────────────
  const caseDoc = useQuery(api.cases.getCaseById, {
    caseId: caseId as Id<"cases">,
  });

  // ── Optional template / mission resolution ──────────────────────────────────
  const templateName = useTemplateName(caseDoc?.templateId ?? null);
  const missionName = useMissionName(caseDoc?.missionId ?? null);

  // ── Common positional aria-label for state tiles ────────────────────────────
  const positionLabel = `Label ${position} of ${total}`;

  // ── Loading state ───────────────────────────────────────────────────────────
  if (caseDoc === undefined) {
    return (
      <div
        className={`${styles.tileState} ${styles.screenOnly}`}
        role="status"
        aria-busy="true"
        aria-label={`${positionLabel}: loading case ${caseId}`}
        data-testid={`batch-tile-loading-${caseId}`}
      >
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.stateText}>
          Loading case <span className={styles.mono}>{caseId}</span>…
        </p>
      </div>
    );
  }

  // ── Not-found state ─────────────────────────────────────────────────────────
  if (caseDoc === null) {
    return (
      <div
        className={`${styles.tileState} ${styles.screenOnly}`}
        role="alert"
        aria-label={`${positionLabel}: case not found`}
        data-testid={`batch-tile-notfound-${caseId}`}
      >
        <p className={styles.stateTitle}>Case not found</p>
        <p className={styles.stateText}>
          No case exists with ID <span className={styles.mono}>{caseId}</span>.
          It will be skipped on the printed batch.
        </p>
      </div>
    );
  }

  // ── QR error state ──────────────────────────────────────────────────────────
  if (qrState.status === "error") {
    return (
      <div
        className={`${styles.tileState} ${styles.screenOnly}`}
        role="alert"
        aria-label={`${positionLabel}: QR generation failed for case ${caseDoc.label}`}
        data-testid={`batch-tile-qr-error-${caseId}`}
      >
        <p className={styles.stateTitle}>
          Could not generate QR code for{" "}
          <span className={styles.mono}>{caseDoc.label}</span>
        </p>
        <p className={styles.stateText}>{qrState.error.message}</p>
      </div>
    );
  }

  // ── QR not yet ready (idle / loading) ───────────────────────────────────────
  if (qrState.status !== "ready") {
    return (
      <div
        className={`${styles.tileState} ${styles.screenOnly}`}
        role="status"
        aria-busy={qrState.status === "loading"}
        aria-label={`${positionLabel}: generating QR code for case ${caseDoc.label}`}
        data-testid={`batch-tile-qr-loading-${caseId}`}
      >
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.stateText}>
          Generating QR code for{" "}
          <span className={styles.mono}>{caseDoc.label}</span>…
        </p>
      </div>
    );
  }

  // ── Ready: render the CaseLabel ────────────────────────────────────────────
  // Each <CaseLabel> root carries `data-case-label-root` and `break-after: page`
  // (from CaseLabel.module.css), so stacking them yields one printer-page per
  // label.  No bespoke print CSS is needed here.
  const status = (caseDoc.status ?? "hangar") as StatusKind;

  return (
    <section
      className={styles.tileReady}
      aria-label={`${positionLabel}: ${caseDoc.label}`}
      data-testid={`batch-tile-ready-${caseId}`}
    >
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
        // The page already has its own batch print button; suppress per-label.
        showPrintButton={false}
      />
    </section>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a template ID to its display name via a reactive Convex query.
 * Returns `null` when the template ID is null/undefined or when the template
 * is not found.  Returns `undefined` while the query is still loading.
 *
 * Mirrors the helper in LabelPageClient so the two routes render the same
 * metadata fields when looking at the same case.
 */
function useTemplateName(
  templateId: Id<"caseTemplates"> | null | undefined,
): string | null | undefined {
  const template = useQuery(
    api.caseTemplates.getCaseTemplateById,
    templateId ? { templateId: templateId as Id<"caseTemplates"> } : "skip",
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
    missionId ? { missionId: missionId as Id<"missions"> } : "skip",
  );
  if (!missionId) return null;
  if (mission === undefined) return undefined;
  if (mission === null) return null;
  return mission.name ?? null;
}
