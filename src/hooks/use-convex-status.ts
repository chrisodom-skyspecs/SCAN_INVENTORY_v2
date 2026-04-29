/**
 * use-convex-status.ts
 *
 * Derives a human-readable connection status from the Convex WebSocket
 * connection state for display in the INVENTORY top bar indicator dot.
 *
 * Status states:
 *   "connected"    — WebSocket is open and operational
 *   "connecting"   — Initial connection attempt (has never connected before)
 *   "reconnecting" — Was connected, now attempting to reconnect
 *   "disconnected" — Connection failed and retry limit exceeded
 *                    (connectionRetries ≥ MAX_RETRY_THRESHOLD)
 *
 * The raw ConnectionState from Convex has:
 *   isWebSocketConnected  — whether the socket is currently open
 *   hasEverConnected      — whether the client has ever reached "ready" state
 *   connectionCount       — how many times it has connected (including reconnects)
 *   connectionRetries     — how many consecutive failed retries in a row
 *   hasInflightRequests   — whether there are pending queries / mutations
 *
 * Visual mapping (used by <ConnectionIndicator />):
 *   connected     → green pulsing dot
 *   connecting    → amber pulsing dot (slower pulse)
 *   reconnecting  → amber fast-pulsing dot
 *   disconnected  → red solid dot (no pulse)
 */

import { useConvexConnectionState } from "convex/react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConvexConnectionStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected";

export interface ConvexStatusResult {
  /** High-level connection status derived from raw Convex state. */
  status: ConvexConnectionStatus;
  /** Whether the WebSocket is currently open (direct from Convex). */
  isConnected: boolean;
  /** Whether the client has ever successfully connected. */
  hasEverConnected: boolean;
  /** Number of consecutive failed reconnection attempts. */
  connectionRetries: number;
  /** Accessible label for the current status (used in aria-label). */
  label: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Number of consecutive failed retries after which we transition from
 * "reconnecting" to "disconnected" to signal a persistent failure.
 */
const MAX_RETRY_THRESHOLD = 5;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the current Convex WebSocket connection status and an accessible label.
 *
 * Uses `useConvexConnectionState` from "convex/react" which subscribes to the
 * client's internal connection state and re-renders whenever it changes.
 *
 * @example
 * const { status, label, isConnected } = useConvexStatus();
 * // status: "connected" | "connecting" | "reconnecting" | "disconnected"
 * // label: "Live — real-time updates active" etc.
 */
export function useConvexStatus(): ConvexStatusResult {
  const { isWebSocketConnected, hasEverConnected, connectionRetries } =
    useConvexConnectionState();

  // ── Derive status ─────────────────────────────────────────────────────────

  let status: ConvexConnectionStatus;

  if (isWebSocketConnected) {
    // Socket is open and operational.
    status = "connected";
  } else if (!hasEverConnected) {
    // Never connected — still attempting the first connection.
    status = "connecting";
  } else if (connectionRetries >= MAX_RETRY_THRESHOLD) {
    // Repeated failures after initial connection — treat as disconnected.
    status = "disconnected";
  } else {
    // Was connected, now temporarily offline — retrying.
    status = "reconnecting";
  }

  // ── Accessible label ──────────────────────────────────────────────────────

  const labels: Record<ConvexConnectionStatus, string> = {
    connected: "Live — real-time updates active",
    connecting: "Connecting to live updates…",
    reconnecting: "Reconnecting — real-time updates interrupted",
    disconnected: "Offline — unable to reach live updates",
  };

  return {
    status,
    isConnected: isWebSocketConnected,
    hasEverConnected,
    connectionRetries,
    label: labels[status],
  };
}
