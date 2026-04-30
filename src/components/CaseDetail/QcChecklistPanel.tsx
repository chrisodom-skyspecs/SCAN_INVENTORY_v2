/**
 * QcChecklistPanel — Read-Only QC Checklist Display
 *
 * A read-only panel section for the INVENTORY dashboard that lists all case
 * manifest items with their condition status indicators (pass / fail /
 * needs-review).  Sourced from the Convex `manifestItems` table via the
 * `useChecklistByCase` subscription — updates arrive within ~100–300 ms of
 * any SCAN app inspection action, satisfying the ≤ 2-second real-time
 * fidelity requirement.
 *
 * Status mapping
 * ──────────────
 *   unchecked → "pending"   (needs-review — not yet inspected)
 *   ok        → "completed" (pass — item confirmed present and undamaged)
 *   damaged   → "flagged"   (fail — item requires attention)
 *   missing   → "exception" (fail — item absent from the case)
 *
 * Rendered via the shared <StatusPill /> component so all status indicators
 * stay consistent with the design system and WCAG AA contrast requirements.
 *
 * Read-only contract
 * ──────────────────
 * This component intentionally contains NO interactive controls — no filter
 * bar, no edit actions, no form elements.  It is designed to be embedded in
 * any T-layout panel or summary view where operators need a compact, at-a-
 * glance QC status overview of all items in a case.
 *
 * Props
 * ─────
 *   caseId    — Convex document ID of the case to display checklist for.
 *   className — Optional additional CSS class for outer wrapper.
 *
 * Data flow
 * ─────────
 *   useChecklistByCase(caseId)
 *     → subscribes to api.checklists.getChecklistByCase
 *     → Convex pushes updates on any manifestItems change for this case
 *     → component re-renders with new item states within ~100–300 ms
 *
 * Accessibility
 * ─────────────
 *   - Items rendered in a <ul> with aria-label
 *   - Each <li> carries aria-label="${name}: ${statusLabel}"
 *   - Progress summary uses aria-label on the <section> element
 *   - StatusPill provides visually distinct color + text for each status
 *   - IBM Plex Mono used for item names (data/tabular content)
 *   - Inter Tight used for labels and section headers (UI typography)
 */

"use client";

import { useChecklistByCase } from "../../queries/checklist";
import { StatusPill } from "../StatusPill";
import shared from "./shared.module.css";
import styles from "./QcChecklistPanel.module.css";
import type { ManifestItemStatus } from "../../queries/checklist";
import type { StatusKind } from "../StatusPill/StatusPill";

// ─── Status mapping ───────────────────────────────────────────────────────────
//
// Maps manifest item completion states to the nearest semantic StatusKind for
// <StatusPill> rendering.  "unchecked" is not a StatusKind — mapped to
// "pending" (neutral / not yet reviewed).

const MANIFEST_TO_STATUS_KIND: Record<ManifestItemStatus, StatusKind> = {
  unchecked: "pending",    // needs-review: item has not yet been inspected
  ok:        "completed",  // pass:         item confirmed present and undamaged
  damaged:   "flagged",    // fail:         item present but documented damage
  missing:   "exception",  // fail:         item not found during inspection
};

/**
 * User-facing status labels for aria attributes and screen readers.
 * These mirror the operator / technician vocabulary used across the app.
 */
const MANIFEST_STATUS_LABEL: Record<ManifestItemStatus, string> = {
  unchecked: "Needs review",
  ok:        "Pass",
  damaged:   "Fail – damaged",
  missing:   "Fail – missing",
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day:   "numeric",
    hour:  "2-digit",
    minute: "2-digit",
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface QcChecklistPanelProps {
  /**
   * Convex document ID of the case whose manifest items should be displayed.
   * Passed directly to `useChecklistByCase` — null suppresses the subscription.
   */
  caseId: string;
  /**
   * Optional additional CSS class applied to the outermost `<section>` element.
   * Use for layout adjustments when embedding in a parent container.
   */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * QcChecklistPanel — read-only list of case manifest items with condition
 * status indicators (pass / fail / needs-review).
 *
 * Subscribes to `api.checklists.getChecklistByCase` via `useChecklistByCase`
 * for real-time Convex updates.  Any SCAN app inspection action (mark ok,
 * damaged, or missing) causes the list to re-render within ~100–300 ms.
 *
 * This component is intentionally read-only — no edit controls are rendered.
 */
export function QcChecklistPanel({ caseId, className }: QcChecklistPanelProps) {
  // Real-time Convex subscription — re-runs whenever any manifestItems row
  // for this case changes.  Convex pushes the diff to all connected dashboard
  // sessions within ~100–300 ms of a SCAN app inspection action.
  //   undefined → loading (initial fetch or reconnect)
  //   []        → no items applied (template not yet set)
  //   item[]    → live list sorted by name
  const items = useChecklistByCase(caseId);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (items === undefined) {
    return (
      <section
        className={[styles.panel, className].filter(Boolean).join(" ")}
        data-testid="qc-checklist-panel-loading"
        aria-busy="true"
        aria-label="Loading QC checklist"
      >
        <div className={shared.emptyState}>
          <div className={shared.spinner} />
        </div>
      </section>
    );
  }

  // ── Empty state — no template applied ─────────────────────────────────────
  if (items.length === 0) {
    return (
      <section
        className={[styles.panel, className].filter(Boolean).join(" ")}
        data-testid="qc-checklist-panel-empty"
        aria-label="QC checklist — no items"
      >
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>QC Checklist</h3>
        </div>
        <div className={shared.emptyState}>
          <p className={shared.emptyStateTitle}>No checklist items</p>
          <p className={shared.emptyStateText}>
            Apply a case template to define the expected packing list.
          </p>
        </div>
      </section>
    );
  }

  // ── Compute summary counts for the section header ────────────────────────
  const totalItems    = items.length;
  const passCount     = items.filter((i) => i.status === "ok").length;
  const failCount     = items.filter((i) => i.status === "damaged" || i.status === "missing").length;
  const reviewCount   = items.filter((i) => i.status === "unchecked").length;

  return (
    <section
      className={[styles.panel, className].filter(Boolean).join(" ")}
      data-testid="qc-checklist-panel"
      aria-label="QC checklist"
    >
      {/* ── Section header with item count ──────────────────────────── */}
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>QC Checklist</h3>
        <span
          className={shared.timestamp}
          aria-label={`${totalItems} item${totalItems !== 1 ? "s" : ""}`}
        >
          {totalItems} item{totalItems !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Summary counts row ──────────────────────────────────────── */}
      <div
        className={styles.summaryRow}
        aria-label={`${passCount} pass, ${failCount} fail, ${reviewCount} needs review`}
      >
        {passCount > 0 && (
          <span className={styles.summaryPass}>
            {passCount} pass
          </span>
        )}
        {failCount > 0 && (
          <span className={styles.summaryFail}>
            {failCount} fail
          </span>
        )}
        {reviewCount > 0 && (
          <span className={styles.summaryReview}>
            {reviewCount} needs review
          </span>
        )}
      </div>

      {/* ── Item list ───────────────────────────────────────────────── */}
      <ul
        className={styles.itemList}
        aria-label="QC checklist items"
        data-testid="qc-checklist-item-list"
      >
        {items.map((item) => {
          const status = (item.status ?? "unchecked") as ManifestItemStatus;
          const statusKind  = MANIFEST_TO_STATUS_KIND[status] ?? "pending";
          const statusLabel = MANIFEST_STATUS_LABEL[status]   ?? "Needs review";

          return (
            <li
              key={item._id}
              className={[
                styles.item,
                styles[`item-${status}`],
              ].filter(Boolean).join(" ")}
              data-testid="qc-checklist-item"
              data-status={status}
              aria-label={`${item.name}: ${statusLabel}`}
            >
              {/* ── Primary row: status pill + item name ────────────── */}
              <div className={styles.itemRow}>
                {/*
                  StatusPill — sole mechanism for status color rendering.
                  Uses design-system signal tokens; no hex literals here.
                  Screen readers see the statusLabel via the li aria-label.
                */}
                <StatusPill
                  kind={statusKind as Parameters<typeof StatusPill>[0]["kind"]}
                />
                <span
                  className={styles.itemName}
                  data-testid="qc-item-name"
                >
                  {item.name}
                </span>
              </div>

              {/* ── Notes — technician free-text from SCAN app ──────── */}
              {item.notes && (
                <p className={styles.itemNote}>{item.notes}</p>
              )}

              {/* ── Attribution — checker name + timestamp ────────────
                  Only shown when the item has been reviewed (status ≠ unchecked).
                  checkedByName and checkedAt are set by the SCAN app mutation
                  when the technician marks the item ok / damaged / missing.
              ─────────────────────────────────────────────────────────── */}
              {item.checkedByName && item.checkedAt && status !== "unchecked" && (
                <p className={shared.timestamp}>
                  {statusLabel} by {item.checkedByName} ·{" "}
                  {formatTimestamp(item.checkedAt)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default QcChecklistPanel;
