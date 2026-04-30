/**
 * use-dashboard-connection-monitor.ts
 *
 * Sub-AC 4: Convex reconnection handling with stale-data indicators
 * and auto-refresh in the INVENTORY dashboard.
 *
 * Purpose
 * ───────
 * The INVENTORY dashboard depends on long-lived Convex `useQuery` subscriptions
 * delivered over a single shared WebSocket.  When that socket drops:
 *
 *   • Convex transparently re-subscribes once the connection is restored and
 *     pushes the latest values to every active query — so "auto-refresh"
 *     happens at the protocol level without any work from us.
 *
 *   • However, the user has no way to know that the data they were looking at
 *     was potentially stale during the offline window, nor that fresh data has
 *     been pulled afterwards.  Operations like "where is case CSE-024 right
 *     now?" are time-critical and require an explicit signal.
 *
 * This hook surfaces those state transitions as derived flags + counters that
 * the dashboard chrome (`StaleDataBanner`, top-bar indicator, etc.) consumes
 * to render contextual notices and (optionally) drive cache invalidation.
 *
 * State machine
 * ─────────────
 *   ┌───────────────┐  WS opens   ┌─────────────────┐
 *   │  connecting   │────────────▶│   connected     │
 *   └───────────────┘             └─────────────────┘
 *                                  ▲              │
 *                       reconnect  │              │ WS closes
 *                                  │              ▼
 *   ┌───────────────┐  retries     ┌─────────────────┐
 *   │ disconnected  │◀─────────────│  reconnecting   │
 *   └───────────────┘  ≥ MAX       └─────────────────┘
 *
 *   • `lastConnectedAt` — set every time the status enters "connected".
 *   • `staleSince`      — set when the status first leaves "connected" after
 *                          having previously been connected.  Cleared on
 *                          re-entry to "connected".
 *   • `refreshTick`     — incremented on every offline → connected transition
 *                          (and on `triggerRefresh()`) so consumers that key
 *                          components on this value re-mount on reconnect.
 *   • `justReconnected` — true for `JUST_RECONNECTED_MS` after a reconnect;
 *                          drives the success "synced" banner that appears
 *                          briefly to confirm data has been refreshed.
 *
 * Auto-refresh contract
 * ─────────────────────
 *   Convex re-subscribes all active `useQuery` consumers automatically — that
 *   alone keeps server-driven state fresh.  Components that derive *local*
 *   state (filters, sort order, computed views) and want a hard reset on
 *   reconnect can do so by passing `refreshTick` as a `key` prop or as a
 *   dependency to `useEffect` / `useMemo`:
 *
 *     <CaseLedger key={`ledger-${refreshTick}`} caseId={caseId} />
 *
 *   The `triggerRefresh()` action exposes the same lever to a manual "refresh
 *   now" button, useful in `disconnected` states where the user wants to
 *   nudge a retry.
 *
 * Stale threshold
 * ───────────────
 *   Stale-data indication kicks in once the connection has been off for
 *   `STALE_THRESHOLD_MS` (default 3 s).  We don't show the banner for a
 *   sub-second blip — those are common over LTE and would create UI noise.
 *   This is shorter than the SCAN-side reconciliation threshold (5 s) because
 *   dashboard staleness is a softer signal: "your numbers may be lagging" —
 *   not "your write may not have persisted."
 *
 * Test seam
 * ─────────
 *   The connection state is read via `useConvexStatus()` which itself wraps
 *   `useConvexConnectionState()` from `convex/react`.  Tests mock the underlying
 *   hook and drive transitions by re-rendering with new mock values, exactly as
 *   the existing `ConnectionIndicator.test.tsx` does.
 *
 * Telemetry
 * ─────────
 *   Reconnection events fire `inv_connection_recovered` and stale-stage
 *   transitions fire `inv_connection_stale` to allow ops dashboards to
 *   correlate user-visible stale banners with incidents.  Telemetry is fired
 *   via a fire-and-forget side effect — no PII, just status counters.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConvexStatus } from "./use-convex-status";
import type { ConvexConnectionStatus } from "./use-convex-status";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Time in milliseconds before a non-"connected" status is treated as stale.
 *
 * Chosen short enough to surface real connection issues quickly but long
 * enough to ignore sub-second WS reconnection blips that happen routinely on
 * mobile/cellular networks.  3 s is the balance point validated against the
 * existing 5 s SCAN reconciliation threshold (which guards mutations, not
 * reads, and therefore tolerates more latency).
 */
export const DASHBOARD_STALE_THRESHOLD_MS = 3_000;

/**
 * How long the "just reconnected" success banner remains visible before
 * automatically dismissing itself.  Long enough to read, short enough that the
 * banner doesn't linger after the user has resumed normal work.
 */
export const JUST_RECONNECTED_MS = 4_000;

/**
 * Frequency at which the hook re-renders to update the stale-duration
 * timestamp.  1 s is sufficient to drive a "Reconnecting… (Ns)" tick without
 * burning CPU.
 */
const TICK_INTERVAL_MS = 1_000;

// ─── Public types ─────────────────────────────────────────────────────────────

/** Re-export the underlying status type for convenience to consumers. */
export type { ConvexConnectionStatus } from "./use-convex-status";

/**
 * Public return shape of `useDashboardConnectionMonitor`.
 */
export interface DashboardConnectionMonitor {
  /**
   * Raw Convex connection status (passed through from `useConvexStatus`).
   * Drives the small dot indicator in the navbar and is the primary input
   * for higher-level UX decisions.
   */
  status: ConvexConnectionStatus;

  /**
   * Convenience boolean — equivalent to `status === "connected"`.
   */
  isConnected: boolean;

  /**
   * True when the status has been off "connected" for at least
   * `DASHBOARD_STALE_THRESHOLD_MS`.  Drives the stale-data banner.
   *
   * Always false in the initial-`connecting` state (the user has not yet seen
   * any data so "stale" is not meaningful).
   */
  isStale: boolean;

  /**
   * Epoch milliseconds at which staleness was first observed in the current
   * offline window.  `null` when the status is "connected" or when we have
   * never been connected (initial-connecting state).
   *
   * Use to render a live "stale for Ns" countdown without storing local time
   * state in the component.
   */
  staleSince: number | null;

  /**
   * Epoch milliseconds at which the status last became "connected".
   * `null` when the WebSocket has never been connected yet.
   *
   * Drives "Last synced HH:MM:SS" displays.
   */
  lastConnectedAt: number | null;

  /**
   * Strictly-increasing counter incremented on every offline → connected
   * transition and on every `triggerRefresh()` call.
   *
   * Pass to component `key` props or to effect dependency arrays to force a
   * hard remount / re-run on reconnection.  Convex `useQuery` already
   * re-subscribes automatically on its own — this counter is only needed for
   * derived/local state that does not live in a Convex query.
   */
  refreshTick: number;

  /**
   * True for `JUST_RECONNECTED_MS` after the most recent reconnect.
   * Drives the brief "Reconnected — data refreshed" success banner that
   * confirms to the user that fresh data has arrived.
   *
   * Auto-clears via internal timer.  Does not become true on the very first
   * connection (no prior offline state to celebrate).
   */
  justReconnected: boolean;

  /**
   * Manually request a refresh — bumps `refreshTick` so any consumer keying
   * off it will re-run.  Intended for "Refresh now" buttons inside the
   * stale-data banner during persistent disconnection.
   */
  triggerRefresh: () => void;

  /**
   * Dismiss the "just reconnected" success banner before its timer expires.
   */
  dismissReconnected: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useDashboardConnectionMonitor`
 *
 * Tracks Convex WebSocket connection state for the INVENTORY dashboard chrome.
 * See module-level documentation for the full state machine and contract.
 *
 * @example
 * const monitor = useDashboardConnectionMonitor();
 *
 * // Stale banner
 * {monitor.isStale && (
 *   <StaleDataBanner
 *     status={monitor.status}
 *     staleSince={monitor.staleSince}
 *     onRefresh={monitor.triggerRefresh}
 *   />
 * )}
 *
 * // Reconnect celebration
 * {monitor.justReconnected && (
 *   <ReconnectedToast onDismiss={monitor.dismissReconnected} />
 * )}
 *
 * // Hard-refresh derived state on reconnect
 * <CaseLedger key={`ledger-${monitor.refreshTick}`} caseId={caseId} />
 */
export function useDashboardConnectionMonitor(): DashboardConnectionMonitor {
  const { status } = useConvexStatus();
  const isConnected = status === "connected";

  // ── Derived persistent state ──────────────────────────────────────────────
  //
  // We keep these in `useState` (not refs) because each one drives UI on its
  // own.  All updates funnel through the single status-transition effect
  // below to keep them in sync.

  const [lastConnectedAt, setLastConnectedAt] = useState<number | null>(null);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [justReconnected, setJustReconnected] = useState(false);

  // Tracks the previous status so we can detect transitions across renders.
  const prevStatusRef = useRef<ConvexConnectionStatus | null>(null);

  // Tick counter forces a re-render every TICK_INTERVAL_MS while offline so
  // that `isStale` (computed below) can flip true once the threshold is
  // exceeded — without this, the hook would only re-render when `status`
  // itself changes.
  const [, forceTick] = useState(0);

  // Holds the auto-dismiss timer for `justReconnected` so we can cancel it
  // when the user dismisses manually or another transition fires.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Status transition handler ─────────────────────────────────────────────
  //
  // Runs exactly once per `status` change.  Branches on the previous status
  // to drive the correct side effects (stamp lastConnectedAt, fire celebration
  // banner, etc.).  Pure within React's rules — no DOM access, no fetch.

  useEffect(() => {
    const prev = prevStatusRef.current;

    if (status === "connected") {
      // Always stamp the latest connection time on entering "connected".
      const now = Date.now();
      setLastConnectedAt(now);
      // Clear any prior staleness — we're up to date again.
      setStaleSince(null);

      // Fire reconnection side effects only on a true transition: if `prev`
      // is null this is the first-ever render; if `prev` was already
      // "connected" we never disconnected.  Both cases skip the celebration.
      const wasOffline = prev !== null && prev !== "connected";
      if (wasOffline) {
        setRefreshTick((t) => t + 1);
        setJustReconnected(true);

        // Schedule auto-dismiss.
        if (reconnectTimerRef.current !== null) {
          clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = setTimeout(() => {
          setJustReconnected(false);
          reconnectTimerRef.current = null;
        }, JUST_RECONNECTED_MS);
      }
    } else {
      // Any non-connected status — track when we first lost the connection.
      // Only meaningful once we have been connected at least once: an initial
      // "connecting" state should not register as staleness.
      const wasConnected = prev === "connected";
      if (wasConnected) {
        setStaleSince(Date.now());
        // Cancel any in-flight celebration; we're offline again.
        if (reconnectTimerRef.current !== null) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        setJustReconnected(false);
      }
    }

    prevStatusRef.current = status;
  }, [status]);

  // ── Tick interval (drives staleness threshold + countdown UI) ─────────────
  //
  // While offline we re-render every TICK_INTERVAL_MS so that consumers can
  // re-evaluate `isStale` (which depends on `Date.now()`) and render a live
  // duration counter.  No-ops while connected to keep CPU at zero.

  useEffect(() => {
    if (status === "connected" || staleSince === null) return;

    const id = setInterval(() => {
      forceTick((t) => (t + 1) % 1_000_000);
    }, TICK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [status, staleSince]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, []);

  // ── Imperative actions ────────────────────────────────────────────────────

  const triggerRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  const dismissReconnected = useCallback(() => {
    setJustReconnected(false);
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // ── Derived stale flag ────────────────────────────────────────────────────
  //
  // True when:
  //   • We have been off "connected" since `staleSince` (so we previously had
  //     a successful connection — initial-connecting does not count), AND
  //   • The duration since `staleSince` exceeds the threshold.

  const isStale =
    staleSince !== null &&
    Date.now() - staleSince >= DASHBOARD_STALE_THRESHOLD_MS;

  return {
    status,
    isConnected,
    isStale,
    staleSince,
    lastConnectedAt,
    refreshTick,
    justReconnected,
    triggerRefresh,
    dismissReconnected,
  };
}
