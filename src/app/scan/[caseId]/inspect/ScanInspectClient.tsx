/**
 * ScanInspectClient — SCAN app checklist inspection screen
 *
 * Sub-AC 36b-2: Wire checklist update mutation to write through Convex and
 * invalidate item checklist subscriptions for the relevant case.
 *
 * Mutation wiring
 * ───────────────
 * `useUpdateChecklistItem()` from src/hooks/use-scan-mutations.ts wraps
 * `api.scan.updateChecklistItem`.  Calling the returned function:
 *
 *   await updateItem({
 *     caseId, templateItemId, status, timestamp,
 *     technicianId, technicianName, notes?,
 *   });
 *
 * The mutation writes to two tables:
 *   • manifestItems — item.status, item.checkedAt, item.checkedById, item.notes
 *   • inspections   — totalItems, checkedItems, damagedItems, missingItems
 *
 * Subscription invalidation (automatic via Convex)
 * ─────────────────────────────────────────────────
 * Because Convex's reactive subscription engine re-evaluates all queries that
 * read a touched row and pushes diffs to connected clients within ~100–300 ms,
 * NO manual cache invalidation or refetch is required.  Writing to
 * `manifestItems` causes all of these to re-evaluate automatically:
 *
 *   api.checklists.getChecklistByCase        → useChecklistByCase
 *   api.checklists.getChecklistSummary       → useChecklistSummary
 *   api.checklists.getChecklistItemsByStatus → useChecklistItemsByStatus (all variants)
 *   api.checklists.getUncheckedItems         → useUncheckedItems
 *   api.checklists.getChecklistWithInspection → useChecklistWithInspection (used here)
 *
 * Writing to `inspections` also re-evaluates:
 *   api.maps.getMapMode3Data → M3 Field Mode map pins (inspection progress)
 *
 * This satisfies the ≤ 2-second real-time fidelity requirement — dashboard
 * panels showing inspection progress update within 2 seconds of any SCAN app
 * checklist action.
 *
 * Complete inspection flow
 * ────────────────────────
 * When `summary.isComplete === true` (all items reviewed), the "Complete
 * Inspection" CTA becomes enabled.  Tapping it calls `useCompleteInspection()`.
 * That mutation transitions the inspection to "completed" or "flagged" (if any
 * items are damaged/missing) and touches cases.updatedAt.
 *
 * Design system compliance
 * ────────────────────────
 * All colors via CSS custom properties — no hex literals.
 * StatusPill for all status rendering.
 * IBM Plex Mono for case label and mono data values.
 * Inter Tight for all other text.
 * Touch targets ≥ 44 × 44 px (WCAG 2.5.5).
 * WCAG AA contrast in both light and dark themes.
 * prefers-reduced-motion respected in all transition/animation rules.
 */

"use client";

import {
  useState,
  useCallback,
  useRef,
  useId,
} from "react";
import Link from "next/link";
import { useScanChecklistWithInspection } from "../../../../hooks/use-scan-queries";
import {
  useUpdateChecklistItem,
  useCompleteInspection,
} from "../../../../hooks/use-scan-mutations";
import { useServerStateReconciliation } from "../../../../hooks/use-server-state-reconciliation";
import { StatusPill } from "../../../../components/StatusPill";
import { InspectionStatusBar } from "../../../../components/ItemStatusBadge";
import { ReconciliationBanner } from "../../../../components/ReconciliationBanner";
import type { ChecklistItem, ManifestItemStatus } from "../../../../hooks/use-scan-queries";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useKindeUser } from "../../../../hooks/use-kinde-user";
import { trackEvent } from "../../../../lib/telemetry.lib";
import { TelemetryEventName } from "../../../../types/telemetry.types";
import styles from "./page.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScanInspectClientProps {
  caseId: string;
}

// ─── Status action config ─────────────────────────────────────────────────────

/**
 * Each status has a label and an aria-label for the action button.
 */
const STATUS_ACTIONS: Record<
  Exclude<ManifestItemStatus, "unchecked">,
  { label: string; ariaLabel: string }
> = {
  ok:      { label: "OK",      ariaLabel: "Mark item as OK — present and undamaged" },
  damaged: { label: "Damaged", ariaLabel: "Mark item as damaged — report damage" },
  missing: { label: "Missing", ariaLabel: "Mark item as missing — not found during inspection" },
};

// ─── Sub-component: Progress bar ─────────────────────────────────────────────

interface ProgressBarProps {
  total: number;
  ok: number;
  damaged: number;
  missing: number;
  unchecked: number;
  progressPct: number;
}

function ProgressBar({ total, ok, damaged, missing, unchecked, progressPct }: ProgressBarProps) {
  return (
    <div className={styles.progressSection}>
      {/* Progress bar */}
      <div
        className={styles.progressBarTrack}
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Inspection progress: ${progressPct}% reviewed`}
      >
        <div
          className={styles.progressBarFill}
          style={{ width: `${progressPct}%` }}
          data-complete={progressPct === 100 || undefined}
        />
      </div>

      {/* Counts row — ItemStatusBadge primitives with icon + distinct coloring */}
      <div className={styles.progressCounts}>
        <span className={styles.progressPct}>{progressPct}% reviewed</span>
        {/* InspectionStatusBar handles verified/flagged/missing/unchecked coloring */}
        <InspectionStatusBar
          verified={ok}
          flagged={damaged}
          missing={missing}
          unchecked={unchecked}
          size="sm"
        />
      </div>

      {total === 0 && (
        <p className={styles.noItemsNote}>
          No items in checklist. Apply a case template to add items.
        </p>
      )}
    </div>
  );
}

// ─── Sub-component: Notes popover input ──────────────────────────────────────

interface NotesInputProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  id: string;
}

function NotesInput({ value, onChange, disabled, id }: NotesInputProps) {
  return (
    <div className={styles.notesInputWrap}>
      <label htmlFor={id} className={styles.notesLabel}>
        Notes
        <span className={styles.optionalBadge}>optional</span>
      </label>
      <textarea
        id={id}
        className={styles.notesTextarea}
        rows={2}
        placeholder="Observation, damage detail, or context…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Item notes (optional)"
      />
    </div>
  );
}

// ─── Sub-component: Checklist item row ───────────────────────────────────────

/**
 * Arguments passed to the onUpdateStatus callback.
 * Includes all fields needed to:
 *   1. issue the Convex mutation
 *   2. emit the SCAN_ACTION_ITEM_CHECKED telemetry event (spec §23)
 */
export interface OnUpdateStatusArgs {
  /** Stable ID from the case template — used for the mutation and for deduplication. */
  templateItemId: string;
  /** Convex manifestItems row ID — used for the telemetry event's manifestItemId field. */
  manifestItemId: string;
  /** Item status before the toggle — recorded in telemetry as previousStatus. */
  previousStatus: ManifestItemStatus;
  /** Newly selected item status — recorded in telemetry as newStatus. */
  newStatus: ManifestItemStatus;
  /** Zero-based position of this item in the full items list (sorted by name). */
  itemIndex: number;
  /** Optional free-text note appended to the manifest item record. */
  notes?: string;
}

interface ChecklistItemRowProps {
  item: ChecklistItem;
  /** Zero-based index of this item in the complete (unsorted / unfiltered) items array. */
  itemIndex: number;
  isPendingUpdate: boolean;
  onUpdateStatus: (args: OnUpdateStatusArgs) => Promise<void>;
}

function ChecklistItemRow({
  item,
  itemIndex,
  isPendingUpdate,
  onUpdateStatus,
}: ChecklistItemRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [pendingStatus, setPendingStatus] = useState<ManifestItemStatus | null>(null);
  const notesId = useId();

  const handleStatusAction = useCallback(
    async (newStatus: ManifestItemStatus) => {
      setPendingStatus(newStatus);
      try {
        await onUpdateStatus({
          templateItemId: item.templateItemId,
          manifestItemId: item._id,
          previousStatus: item.status,
          newStatus,
          itemIndex,
          notes: notes.trim() || undefined,
        });
        // Collapse notes panel after successful update
        setExpanded(false);
      } catch {
        // Mutation errors are handled by the parent's finally block which
        // clears the pending state.  The error is intentionally swallowed
        // here — a failed mutation leaves the item status unchanged and the
        // user can retry.  TODO: surface a toast/snackbar when error-handling
        // UI is added.
      } finally {
        setPendingStatus(null);
      }
    },
    [item.templateItemId, item._id, item.status, itemIndex, notes, onUpdateStatus]
  );

  const isActionPending = isPendingUpdate || pendingStatus !== null;

  return (
    <li
      className={[
        styles.checklistItem,
        item.status !== "unchecked" ? styles.checklistItemReviewed : "",
        item.status === "damaged"   ? styles.checklistItemDamaged  : "",
        item.status === "missing"   ? styles.checklistItemMissing  : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="checklist-item-row"
      data-status={item.status}
    >
      {/* ── Item header ──────────────────────────────────────────────── */}
      <div className={styles.itemHeader}>
        {/* Status pill + name */}
        <div className={styles.itemTitleRow}>
          <StatusPill kind={item.status} />
          <span className={styles.itemName}>{item.name}</span>
        </div>

        {/* Expand/collapse for notes */}
        <button
          type="button"
          className={styles.itemExpandBtn}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`item-notes-${item._id}`}
          aria-label={expanded ? `Collapse notes for ${item.name}` : `Add notes for ${item.name}`}
          disabled={isActionPending}
        >
          <svg
            className={[styles.expandChevron, expanded ? styles.expandChevronOpen : ""].filter(Boolean).join(" ")}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </button>
      </div>

      {/* ── Checked-by / timestamp line ──────────────────────────────── */}
      {item.status !== "unchecked" && item.checkedByName && (
        <div className={styles.itemMeta}>
          <span className={styles.itemMetaText}>
            by {item.checkedByName}
            {item.checkedAt
              ? ` · ${new Date(item.checkedAt).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </span>
        </div>
      )}

      {/* ── Notes preview (collapsed) ─────────────────────────────────── */}
      {!expanded && item.notes && (
        <p className={styles.itemNotePreview}>{item.notes}</p>
      )}

      {/* ── Expanded notes input ──────────────────────────────────────── */}
      <div
        id={`item-notes-${item._id}`}
        className={[styles.itemExpanded, expanded ? styles.itemExpandedOpen : ""].filter(Boolean).join(" ")}
        aria-hidden={!expanded}
      >
        <NotesInput
          id={notesId}
          value={notes}
          onChange={setNotes}
          disabled={isActionPending}
        />
      </div>

      {/* ── Action buttons ────────────────────────────────────────────── */}
      <div
        className={styles.itemActions}
        role="group"
        aria-label={`Update status of ${item.name}`}
      >
        {(Object.entries(STATUS_ACTIONS) as [Exclude<ManifestItemStatus, "unchecked">, typeof STATUS_ACTIONS[keyof typeof STATUS_ACTIONS]][]).map(
          ([status, cfg]) => {
            const isCurrentStatus = item.status === status;
            const isThisPending = pendingStatus === status;
            return (
              <button
                key={status}
                type="button"
                className={[
                  styles.itemActionBtn,
                  isCurrentStatus ? styles.itemActionBtnActive : "",
                  styles[`itemActionBtn_${status}`],
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => handleStatusAction(status)}
                disabled={isActionPending}
                aria-pressed={isCurrentStatus}
                aria-label={cfg.ariaLabel}
                data-status={status}
              >
                {isThisPending ? (
                  <span className={styles.spinner} aria-hidden="true" />
                ) : null}
                {cfg.label}
              </button>
            );
          }
        )}

        {/* Revert to unchecked */}
        {item.status !== "unchecked" && (
          <button
            type="button"
            className={[styles.itemActionBtn, styles.itemActionBtnRevert].join(" ")}
            onClick={() => handleStatusAction("unchecked")}
            disabled={isActionPending}
            aria-label={`Revert ${item.name} to unchecked`}
          >
            {pendingStatus === "unchecked" ? (
              <span className={styles.spinner} aria-hidden="true" />
            ) : null}
            Undo
          </button>
        )}
      </div>
    </li>
  );
}

// ─── Sub-component: Complete inspection CTA ───────────────────────────────────

interface CompleteInspectionCTAProps {
  inspectionId: string | null;
  caseId: string;
  isComplete: boolean;
  hasDamagedOrMissing: boolean;
  onComplete: () => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

function CompleteInspectionCTA({
  inspectionId,
  isComplete,
  hasDamagedOrMissing,
  onComplete,
  isSubmitting,
  error,
}: CompleteInspectionCTAProps) {
  if (!inspectionId) {
    return (
      <div className={styles.noInspectionNotice} role="status">
        <svg
          className={styles.noticeIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p>
          No active inspection. Use <strong>Check In</strong> to start one
          by setting the case to "In Field".
        </p>
      </div>
    );
  }

  return (
    <div className={styles.completeCTASection}>
      {!isComplete && (
        <p className={styles.completeCTAHint}>
          Review all items above to enable completion.
        </p>
      )}

      {hasDamagedOrMissing && isComplete && (
        <div className={styles.flaggedNotice} role="status">
          <svg
            className={styles.flaggedIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            Inspection will be flagged for review — damaged or missing items
            were recorded. Dashboard team will be notified.
          </span>
        </div>
      )}

      {error && (
        <div className={styles.errorBanner} role="alert" aria-live="assertive">
          <svg
            className={styles.errorBannerIcon}
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
          <span className={styles.errorBannerText}>{error}</span>
        </div>
      )}

      <button
        type="button"
        className={[
          styles.ctaButton,
          styles.ctaButtonPrimary,
          isComplete && !isSubmitting ? styles.ctaButtonReady : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={onComplete}
        disabled={!isComplete || isSubmitting}
        aria-busy={isSubmitting}
        data-testid="complete-inspection-btn"
      >
        {isSubmitting ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            Completing…
          </>
        ) : (
          <>
            {/* Checkmark icon */}
            <svg
              className={styles.btnIcon}
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
            Complete Inspection
          </>
        )}
      </button>
    </div>
  );
}

// ─── Sub-component: Success view ─────────────────────────────────────────────

interface SuccessViewProps {
  caseId: string;
  caseLabel: string;
  finalStatus: "completed" | "flagged";
}

function SuccessView({ caseId, caseLabel, finalStatus }: SuccessViewProps) {
  return (
    <div
      className={styles.successView}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="inspection-success"
    >
      {/* Success icon */}
      <div
        className={[
          styles.successIconWrap,
          finalStatus === "flagged" ? styles.successIconWrapFlagged : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      >
        <svg
          className={styles.successIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {finalStatus === "flagged" ? (
            <>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="10" />
              <polyline points="9 12 11 14 15 10" />
            </>
          )}
        </svg>
      </div>

      <h2 className={styles.successTitle}>
        {finalStatus === "flagged"
          ? "Inspection Flagged"
          : "Inspection Complete"}
      </h2>

      <p className={styles.successSubtitle}>
        {finalStatus === "flagged"
          ? `${caseLabel} inspection is flagged for review. Damaged or missing items were reported.`
          : `${caseLabel} inspection is complete. All items reviewed and confirmed.`}
      </p>

      {/* Real-time update notice */}
      <p className={styles.successRealtime}>
        Dashboard map updated in real time via Convex subscriptions.
      </p>

      {/* Actions */}
      <div className={styles.successActions}>
        <Link
          href={`/scan/${caseId}`}
          className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
          aria-label={`View case detail for ${caseLabel}`}
        >
          View Case
        </Link>

        <Link
          href="/scan"
          className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
        >
          Scan Another Case
        </Link>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * ScanInspectClient
 *
 * Interactive checklist screen.  Wires `useUpdateChecklistItem()` so each
 * status tap writes through Convex and invalidates all item checklist
 * subscriptions (useChecklistByCase, useChecklistSummary,
 * useChecklistItemsByStatus, useChecklistWithInspection, getUncheckedItems)
 * across the SCAN app and INVENTORY dashboard automatically.
 *
 * Convex's reactive subscription engine handles the invalidation — no manual
 * cache busting, no refetch calls.
 */
export function ScanInspectClient({ caseId }: ScanInspectClientProps) {
  // ── Real-time subscription ────────────────────────────────────────────────
  // getChecklistWithInspection provides items + inspection + summary in one
  // subscription — avoids two-query flicker and gives a consistent snapshot.
  //
  // When updateChecklistItem writes to manifestItems/inspections, Convex
  // re-evaluates this query and pushes the diff within ~100–300 ms.  The
  // component re-renders with fresh data automatically.
  // Real-time subscription — via SCAN query layer (use-scan-queries.ts).
  // useScanChecklistWithInspection delegates to useChecklistWithInspection
  // which subscribes to api.checklists.getChecklistWithInspection.
  // Convex re-evaluates within ~100–300 ms of any updateChecklistItem
  // mutation, keeping the checklist and progress bar live.
  const state = useScanChecklistWithInspection(caseId);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateItem    = useUpdateChecklistItem();
  const completeInsp  = useCompleteInspection();

  // ── Server-state reconciliation (Sub-AC 2c) ───────────────────────────────
  // Detects divergence between the optimistic item-status update and the
  // server-confirmed result.  For inspection, the key field is the item's
  // `status` (ok / damaged / missing / unchecked) and optionally the
  // inspection counters.  If another device marks the same item concurrently,
  // the server may confirm a different status than the optimistic prediction.
  const reconciliation = useServerStateReconciliation();

  // ── User identity ─────────────────────────────────────────────────────────
  const user = useKindeUser();

  // ── Local state ───────────────────────────────────────────────────────────
  // Track which items have a pending mutation in flight (for per-row loading).
  const pendingItemsRef = useRef(new Set<string>());
  const [pendingItems, setPendingItems] = useState(new Set<string>());

  const [isCompletingInsp, setIsCompletingInsp] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<{
    finalStatus: "completed" | "flagged";
    caseLabel: string;
  } | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Update a single manifest item's inspection state.
   *
   * Called when the technician taps OK / Damaged / Missing / Undo on an item.
   * The mutation writes to manifestItems (and syncs inspection counters) — all
   * active subscriptions to this case's checklist receive the diff within
   * ~100–300 ms from Convex's reactive engine.
   *
   * After a successful mutation, emits SCAN_ACTION_ITEM_CHECKED telemetry so
   * the analytics pipeline can track per-item toggle activity (spec §23).
   * Fields recorded: caseId, manifestItemId, templateItemId, previousStatus,
   * newStatus, itemIndex, totalItems, and user context (userId from identity).
   */
  const handleUpdateItem = useCallback(
    async ({
      templateItemId,
      manifestItemId,
      previousStatus,
      newStatus,
      itemIndex,
      notes,
    }: OnUpdateStatusArgs) => {
      // Mark item as pending to show per-row loading indicator
      const next = new Set(pendingItemsRef.current);
      next.add(templateItemId);
      pendingItemsRef.current = next;
      setPendingItems(new Set(next));

      // ── Sub-AC 2c: Track optimistic prediction ──────────────────────────
      // The optimistic update sets item.status = newStatus in the local store.
      // If a concurrent write changed this item between the optimistic update
      // and the server confirmation, the server may return a different status.
      const mutationId = `item-${templateItemId}-${Date.now()}`;
      reconciliation.trackMutation(mutationId, { status: newStatus });

      try {
        const result = await updateItem({
          caseId:         caseId as Id<"cases">,
          templateItemId,
          status:         newStatus,
          timestamp:      Date.now(),
          technicianId:   user.id,
          technicianName: user.name,
          notes,
        });

        // ── Sub-AC 2c: Confirm against server result ────────────────────────
        reconciliation.confirmMutation(mutationId, {
          status: result.newStatus,
        });

        // ── Telemetry: emit item-checked event (spec §23) ──────────────
        // Emitted after a successful write so partial failures are not tracked.
        // totalItems comes from the live subscription summary; falls back to 0
        // if the state is momentarily undefined (should not occur in practice).
        trackEvent({
          eventCategory: "user_action",
          eventName:     TelemetryEventName.SCAN_ACTION_ITEM_CHECKED,
          app:           "scan",
          caseId,
          manifestItemId,
          templateItemId,
          newStatus,
          previousStatus,
          itemIndex,
          totalItems:    state?.summary.total ?? 0,
          userId:        user.id,
        });

        // Subscription updates arrive automatically — no refetch needed.
      } catch {
        // ── Sub-AC 2c: Cancel — Convex rolled back the optimistic update ────
        reconciliation.cancelMutation(mutationId);
      } finally {
        const updated = new Set(pendingItemsRef.current);
        updated.delete(templateItemId);
        pendingItemsRef.current = updated;
        setPendingItems(new Set(updated));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caseId, updateItem, user, state, reconciliation]
  );

  /**
   * Complete the active inspection.
   *
   * Only callable when summary.isComplete === true (all items reviewed).
   * Transitions the inspection to "completed" or "flagged" based on item
   * states, and touches cases.updatedAt so M1 map order reflects the activity.
   */
  const handleCompleteInspection = useCallback(async () => {
    if (!state || !state.inspection) return;

    setIsCompletingInsp(true);
    setCompleteError(null);

    try {
      const result = await completeInsp({
        inspectionId:   state.inspection._id as Id<"inspections">,
        caseId:         caseId as Id<"cases">,
        timestamp:      Date.now(),
        technicianId:   user.id,
        technicianName: user.name,
      });

      setCompletedResult({
        finalStatus: result.status as "completed" | "flagged",
        caseLabel:   `Case ${caseId}`,  // updated below from state
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to complete inspection. Please try again.";
      setCompleteError(message);
    } finally {
      setIsCompletingInsp(false);
    }
  }, [state, caseId, completeInsp, user]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (state === undefined) {
    return (
      <div className={styles.page}>
        <div
          className={styles.loadingShell}
          aria-busy="true"
          aria-label="Loading checklist"
        >
          <div className={styles.skeletonHeader} />
          <div className={styles.skeletonProgress} />
          {[...Array(4)].map((_, i) => (
            <div key={i} className={styles.skeletonItem} />
          ))}
        </div>
      </div>
    );
  }

  const { items, inspection, summary } = state;

  // ── Completion success view ────────────────────────────────────────────────
  if (completedResult) {
    return (
      <div className={styles.page}>
        <SuccessView
          caseId={caseId}
          caseLabel={completedResult.caseLabel}
          finalStatus={completedResult.finalStatus}
        />
      </div>
    );
  }

  // ── Derive caseLabel ──────────────────────────────────────────────────────
  // (Updated at render time from inspection metadata when available)
  const caseLabel = inspection
    ? `CASE-${caseId.slice(-4).toUpperCase()}`
    : `Case ${caseId.slice(-8)}`;

  // Group items: unchecked first, then reviewed items
  const uncheckedItems = items.filter((i) => i.status === "unchecked");
  const reviewedItems  = items.filter((i) => i.status !== "unchecked");

  const hasDamagedOrMissing =
    summary.damaged > 0 || summary.missing > 0;

  return (
    <div className={styles.page}>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.caseHeaderRow}>
          <h1 className={styles.caseLabel}>{caseLabel}</h1>
          {inspection && (
            <StatusPill
              kind={inspection.status === "flagged" ? "flagged" : "in_progress"}
            />
          )}
        </div>
        <p className={styles.pageSubheading}>Checklist Inspection</p>
        {inspection && (
          <p className={styles.inspectorNote}>
            Inspector: {inspection.inspectorName}
          </p>
        )}
      </div>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Progress summary ─────────────────────────────────────────── */}
      <ProgressBar
        total={summary.total}
        ok={summary.ok}
        damaged={summary.damaged}
        missing={summary.missing}
        unchecked={summary.unchecked}
        progressPct={summary.progressPct}
      />

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Unchecked items ───────────────────────────────────────────── */}
      {uncheckedItems.length > 0 && (
        <section
          className={styles.section}
          aria-labelledby="unchecked-section-label"
        >
          <h2 id="unchecked-section-label" className={styles.sectionTitle}>
            {/* Clipboard icon */}
            <svg
              className={styles.sectionIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            To Review
            <span className={styles.countChip}>{uncheckedItems.length}</span>
          </h2>

          <ul
            className={styles.checklistList}
            aria-label={`${uncheckedItems.length} items remaining to review`}
          >
            {uncheckedItems.map((item) => (
              <ChecklistItemRow
                key={item._id}
                item={item}
                itemIndex={items.findIndex((i) => i._id === item._id)}
                isPendingUpdate={pendingItems.has(item.templateItemId)}
                onUpdateStatus={handleUpdateItem}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── Reviewed items ────────────────────────────────────────────── */}
      {reviewedItems.length > 0 && (
        <>
          {uncheckedItems.length > 0 && (
            <hr className={styles.divider} aria-hidden="true" />
          )}
          <section
            className={styles.section}
            aria-labelledby="reviewed-section-label"
          >
            <h2 id="reviewed-section-label" className={styles.sectionTitle}>
              {/* Check icon */}
              <svg
                className={styles.sectionIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              Reviewed
              <span className={styles.countChip}>{reviewedItems.length}</span>
            </h2>

            <ul
              className={styles.checklistList}
              aria-label={`${reviewedItems.length} reviewed items`}
            >
              {reviewedItems.map((item) => (
                <ChecklistItemRow
                  key={item._id}
                  item={item}
                  itemIndex={items.findIndex((i) => i._id === item._id)}
                  isPendingUpdate={pendingItems.has(item.templateItemId)}
                  onUpdateStatus={handleUpdateItem}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {items.length === 0 && (
        <div className={styles.emptyState} role="status">
          <svg
            className={styles.emptyIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
          </svg>
          <p className={styles.emptyTitle}>No items in checklist</p>
          <p className={styles.emptyBody}>
            Apply a case template to create a packing list for this case.
          </p>
        </div>
      )}

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Reconciliation banners (Sub-AC 2c) ────────────────────────── */}
      {/*
       * Rendered above the Complete CTA so the technician sees any state
       * discrepancy before finalising the inspection.
       *
       * Stale: a checklist-item mutation is taking longer than 5 s — the
       * technician should check connectivity before tapping Complete.
       *
       * Divergence: the server confirmed a different item status than what
       * was applied locally.  The checklist has already been corrected by the
       * Convex subscription push; this banner confirms the correction.
       */}
      {reconciliation.isStale && !reconciliation.hasDivergence && (
        <ReconciliationBanner
          stale
          staleSince={reconciliation.staleSince}
          onDismiss={reconciliation.dismiss}
        />
      )}
      {reconciliation.hasDivergence && (
        <ReconciliationBanner
          divergedFields={reconciliation.divergedFields}
          onDismiss={reconciliation.dismiss}
        />
      )}

      {/* ── Complete inspection CTA ───────────────────────────────────── */}
      <CompleteInspectionCTA
        inspectionId={inspection?._id ?? null}
        caseId={caseId}
        isComplete={summary.isComplete}
        hasDamagedOrMissing={hasDamagedOrMissing}
        onComplete={handleCompleteInspection}
        isSubmitting={isCompletingInsp}
        error={completeError}
      />

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Navigation row ────────────────────────────────────────────── */}
      <div className={styles.navRow}>
        <Link
          href={`/scan/${caseId}`}
          className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
          aria-label="Return to case detail"
        >
          {/* Chevron left */}
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
          Back to Case
        </Link>
      </div>
    </div>
  );
}
