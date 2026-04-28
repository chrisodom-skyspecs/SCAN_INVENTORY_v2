/**
 * StatusPill — single unified status badge component.
 *
 * All status rendering across INVENTORY and SCAN must use this component.
 * Never render raw status strings or ad-hoc colored spans.
 *
 * Usage:
 *   <StatusPill kind="deployed" />          // subtle (default)
 *   <StatusPill kind="exception" filled />  // solid fill
 *
 * `kind` covers every status value from the Convex schema:
 *   - Case lifecycle:      assembled | deployed | in_field | shipping | returned
 *   - Inspection:          pending | in_progress | completed | flagged
 *   - Shipment:            label_created | picked_up | in_transit |
 *                          out_for_delivery | delivered | exception
 *   - Mission:             planning | active | cancelled
 *                          (completed is shared with inspection)
 */

import styles from "./StatusPill.module.css";

// ─── Status kind type ─────────────────────────────────────────────────────────

export type StatusKind =
  // Case lifecycle
  | "assembled"
  | "deployed"
  | "in_field"
  | "shipping"
  | "returned"
  // Inspection
  | "pending"
  | "in_progress"
  | "completed"
  | "flagged"
  // Manifest item (checklist)
  | "unchecked"
  | "ok"
  | "damaged"
  | "missing"
  // Shipment
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  // Mission
  | "planning"
  | "active"
  | "cancelled";

// ─── Display labels ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<StatusKind, string> = {
  // Case lifecycle
  assembled: "Assembled",
  deployed: "Deployed",
  in_field: "In Field",
  shipping: "Shipping",
  returned: "Returned",
  // Inspection
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  flagged: "Flagged",
  // Manifest item (checklist)
  unchecked: "Unchecked",
  ok: "OK",
  damaged: "Damaged",
  missing: "Missing",
  // Shipment
  label_created: "Label Created",
  picked_up: "Picked Up",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  exception: "Exception",
  // Mission
  planning: "Planning",
  active: "Active",
  cancelled: "Cancelled",
};

// ─── Signal kind mapping ──────────────────────────────────────────────────────

type SignalKind = "success" | "warning" | "error" | "info" | "neutral";

/**
 * Maps each status kind to the corresponding signal token category.
 *
 * Design rationale:
 *   success  → healthy, final positive state
 *   warning  → in-transit / needs attention soon
 *   error    → problem requiring action
 *   info     → active / in-progress state
 *   neutral  → dormant / start / end non-positive state
 */
const STATUS_SIGNAL: Record<StatusKind, SignalKind> = {
  // Case lifecycle
  assembled: "info",       // ready, waiting — informational
  deployed: "success",     // in the field — positive
  in_field: "info",        // actively being used
  shipping: "warning",     // in transit — watch it
  returned: "neutral",     // back at base
  // Inspection
  pending: "neutral",      // not started yet
  in_progress: "info",     // underway
  completed: "success",    // done, all good
  flagged: "error",        // needs review
  // Manifest item (checklist)
  unchecked: "neutral",    // not yet reviewed
  ok: "success",           // present and undamaged
  damaged: "error",        // has damage — requires attention
  missing: "warning",      // not found during inspection
  // Shipment
  label_created: "neutral",
  picked_up: "info",
  in_transit: "warning",
  out_for_delivery: "info",
  delivered: "success",
  exception: "error",
  // Mission
  planning: "neutral",
  active: "success",
  cancelled: "neutral",
};

// ─── Signal class map ─────────────────────────────────────────────────────────

const SIGNAL_CLASS: Record<SignalKind, string> = {
  success: styles.signalSuccess,
  warning: styles.signalWarning,
  error: styles.signalError,
  info: styles.signalInfo,
  neutral: styles.signalNeutral,
};

// ─── Component ────────────────────────────────────────────────────────────────

export interface StatusPillProps {
  /** Status identifier — drives label text and color token selection */
  kind: StatusKind;
  /**
   * When true, uses solid filled background (pill) instead of subtle tint.
   * Default: false (subtle / tinted)
   */
  filled?: boolean;
  /** Additional class name applied to the pill span */
  className?: string;
  /** Override display label (falls back to STATUS_LABELS[kind]) */
  label?: string;
}

/**
 * Single source of truth for all status badge rendering.
 *
 * Uses design-system signal tokens for color — never hard-coded hex values.
 * WCAG AA compliant in both light and dark themes.
 */
export function StatusPill({
  kind,
  filled = false,
  className,
  label,
}: StatusPillProps) {
  const signal = STATUS_SIGNAL[kind];
  const displayLabel = label ?? STATUS_LABELS[kind] ?? kind;
  const signalClass = SIGNAL_CLASS[signal];
  const variantClass = filled ? styles.filled : styles.subtle;

  const pillClass = [styles.pill, signalClass, variantClass, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={pillClass}
      role="status"
      aria-label={`Status: ${displayLabel}`}
    >
      {displayLabel}
    </span>
  );
}
