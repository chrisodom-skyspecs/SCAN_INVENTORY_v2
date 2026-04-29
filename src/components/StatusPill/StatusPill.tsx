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
 *   - Case lifecycle:      hangar | assembled | transit_out | deployed |
 *                          flagged | transit_in | received | archived
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
  | "hangar"
  | "assembled"
  | "transit_out"
  | "deployed"
  | "flagged"
  | "transit_in"
  | "received"
  | "archived"
  // Inspection
  | "pending"
  | "in_progress"
  | "completed"
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
  hangar:      "In Hangar",
  assembled:   "Assembled",
  transit_out: "Transit Out",
  deployed:    "Deployed",
  flagged:     "Flagged",
  transit_in:  "Transit In",
  received:    "Received",
  archived:    "Archived",
  // Inspection
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
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
  hangar:      "neutral",  // stored, dormant
  assembled:   "info",     // ready, waiting — informational
  transit_out: "warning",  // in transit outbound — watch it
  deployed:    "success",  // actively in use at site — positive
  flagged:     "error",    // has outstanding issues — needs attention
  transit_in:  "warning",  // in transit inbound — watch it
  received:    "neutral",  // back at base
  archived:    "neutral",  // decommissioned
  // Inspection
  pending: "neutral",      // not started yet
  in_progress: "info",     // underway
  completed: "success",    // done, all good
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
