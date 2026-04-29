/**
 * ConnectionIndicator — Live WebSocket status dot for the INVENTORY top bar
 *
 * A small circular dot that reflects the Convex WebSocket connection state.
 * When connected, the dot pulses gently to signal live real-time updates.
 * When connecting or reconnecting, it pulses faster in an amber color.
 * When disconnected, it shows as a red solid dot with no animation.
 *
 * Visual states:
 *   connected     → green pulsing dot (--signal-success-fill)
 *   connecting    → amber slow-pulse dot (--signal-warning-fill)
 *   reconnecting  → amber fast-pulse dot (--signal-warning-fill)
 *   disconnected  → red solid dot (--signal-error-fill)
 *
 * Accessibility:
 *   • role="status" on the wrapper — screen reader announces state changes
 *   • aria-label reflects the human-readable status string
 *   • The dot itself is aria-hidden; the wrapper conveys meaning
 *   • Reduced motion: pulse animation disabled, dot shows as solid fill
 *
 * Design tokens only — no hex literals.
 * All animation speeds use the --conn-* custom properties defined locally
 * so they can be overridden in tests without affecting the global token file.
 */

"use client";

import { useConvexStatus } from "@/hooks/use-convex-status";
import type { ConvexConnectionStatus } from "@/hooks/use-convex-status";
import styles from "./ConnectionIndicator.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ConnectionIndicatorProps {
  /** Additional CSS class names to apply to the wrapper. */
  className?: string;
  /**
   * When true, show a short text label next to the dot.
   * Default: false (dot only — compact form for the navbar).
   */
  showLabel?: boolean;
}

// ─── Label map ────────────────────────────────────────────────────────────────

const SHORT_LABELS: Record<ConvexConnectionStatus, string> = {
  connected: "Live",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  disconnected: "Offline",
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Live WebSocket connection status dot.
 *
 * Subscribes to Convex connection state via useConvexStatus() and renders a
 * colored pulsing dot that communicates the current connection health.
 *
 * @example
 * // Compact dot (navbar)
 * <ConnectionIndicator />
 *
 * // With label (status bar)
 * <ConnectionIndicator showLabel />
 */
export function ConnectionIndicator({
  className,
  showLabel = false,
}: ConnectionIndicatorProps) {
  const { status, label } = useConvexStatus();

  return (
    <span
      className={[styles.wrapper, className].filter(Boolean).join(" ")}
      role="status"
      aria-label={label}
      aria-live="polite"
      data-status={status}
      title={label}
    >
      {/* The dot — aria-hidden because the wrapper carries the meaning */}
      <span
        className={styles.dot}
        aria-hidden="true"
        data-status={status}
      />

      {/* Optional short label — hidden at compact (navbar) size */}
      {showLabel && (
        <span className={styles.label} aria-hidden="true">
          {SHORT_LABELS[status]}
        </span>
      )}
    </span>
  );
}

export default ConnectionIndicator;
