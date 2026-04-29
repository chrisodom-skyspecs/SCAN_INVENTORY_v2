/**
 * SwimLaneErrorBoundary — React Error Boundary for the swim-lane board.
 *
 * Wraps `T3SwimLaneConnected` (or any child that calls `useQuery`) and catches
 * any errors thrown by Convex's real-time subscription hooks.  When an error is
 * caught, it renders `T3SwimLane` in its error state — showing the per-column
 * error placeholder with an optional "Try again" button in all four columns.
 *
 * Architecture note
 * ─────────────────
 * React Error Boundaries must be class components.  This component is a thin
 * boundary wrapper that:
 *   1. Catches errors via `getDerivedStateFromError` / `componentDidCatch`.
 *   2. On error, renders `<T3SwimLane error={...} onRetry={reset} />` — the
 *      presentational component is used directly so the board layout remains
 *      intact (all 4 columns visible, each showing the error placeholder).
 *   3. `reset()` — triggered by the "Try again" button — clears the error state
 *      and increments a `resetKey` prop on the child subtree, forcing a full
 *      remount (and therefore a fresh Convex subscription).
 *
 * Usage
 * ─────
 * Wrap any component that uses `useSwimLaneBoard` (i.e. `T3SwimLaneConnected`):
 *
 *   <SwimLaneErrorBoundary>
 *     <T3SwimLaneConnected
 *       selectedCaseId={selectedId}
 *       onSelectCase={setSelectedId}
 *     />
 *   </SwimLaneErrorBoundary>
 *
 * Or use the pre-composed `T3SwimLaneConnectedWithBoundary` export from
 * `T3SwimLaneConnected.tsx` which includes the boundary automatically.
 *
 * Propagation
 * ───────────
 * Errors that escape this boundary (e.g., render errors from child components
 * other than the swim-lane hook) will continue to propagate to a higher-level
 * boundary.  This boundary is intentionally scoped to the swim-lane board to
 * avoid masking unrelated errors.
 */

"use client";

import React from "react";
import { T3SwimLane } from "./T3SwimLane";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SwimLaneErrorBoundaryProps {
  /** Child subtree containing the Convex-wired swim-lane component. */
  children: React.ReactNode;
  /**
   * Optional render prop for a custom error fallback.
   * When provided, overrides the default T3SwimLane error state rendering.
   * Receives the caught error and a `reset` callback for retry.
   */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface SwimLaneErrorBoundaryState {
  /** Whether an error has been caught. */
  hasError: boolean;
  /** The caught error (or null when no error). */
  error: Error | null;
  /**
   * Incremented on reset to force the child subtree to remount.
   * React re-mounts children when their `key` changes — this clears the
   * error in the Convex subscription layer, initiating a fresh connection.
   */
  resetKey: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * React Error Boundary that wraps the swim-lane board.
 *
 * Catches Convex query errors and subscription failures that propagate as
 * uncaught React errors through `useQuery`.  On error, renders a per-column
 * error placeholder with an optional retry mechanism.
 */
export class SwimLaneErrorBoundary extends React.Component<
  SwimLaneErrorBoundaryProps,
  SwimLaneErrorBoundaryState
> {
  constructor(props: SwimLaneErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error:    null,
      resetKey: 0,
    };
    this.handleReset = this.handleReset.bind(this);
  }

  /**
   * Called during render when a descendant throws.
   * Returns the state update that switches to error mode.
   * Must be a static method — this is the React error boundary API.
   */
  static getDerivedStateFromError(error: Error): Partial<SwimLaneErrorBoundaryState> {
    return {
      hasError: true,
      error:    error instanceof Error ? error : new Error(String(error)),
    };
  }

  /**
   * Called after an error is caught.  Safe place for logging.
   * componentDidCatch is not used for state updates (getDerivedStateFromError
   * handles that) but may be used in future for telemetry integration.
   */
  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log to console in development so developers can see the full stack trace.
    // In production, swap for your telemetry sink (e.g., Sentry.captureException).
    if (process.env.NODE_ENV !== "production") {
      console.error(
        "[SwimLaneErrorBoundary] Caught a Convex subscription error:",
        error,
        info.componentStack
      );
    }
  }

  /**
   * Reset the boundary, clearing the error and remounting the child subtree.
   *
   * Incrementing `resetKey` causes React to unmount + remount the children
   * keyed by that value, which in turn tears down and re-establishes the
   * Convex WebSocket subscription — effectively retrying the query.
   */
  handleReset(): void {
    this.setState((prev) => ({
      hasError: false,
      error:    null,
      resetKey: prev.resetKey + 1,
    }));
  }

  render(): React.ReactNode {
    const { hasError, error, resetKey } = this.state;
    const { children, fallback } = this.props;

    if (hasError && error !== null) {
      // ── Custom fallback ────────────────────────────────────────────────────
      if (typeof fallback === "function") {
        return fallback(error, this.handleReset);
      }

      // ── Default: T3SwimLane in error state ────────────────────────────────
      // Renders all 4 columns in the error placeholder state.
      // `onRetry` triggers handleReset → child remount → fresh Convex sub.
      return (
        <T3SwimLane
          error={error}
          onRetry={this.handleReset}
          // Accessibility: announce the error region
          aria-live="assertive"
        />
      );
    }

    // ── Happy path ───────────────────────────────────────────────────────────
    // `key={resetKey}` forces a full remount when retry is triggered.
    // React will unmount the current children and mount fresh ones,
    // clearing any error state in the Convex hook layer.
    return (
      <React.Fragment key={resetKey}>
        {children}
      </React.Fragment>
    );
  }
}

export default SwimLaneErrorBoundary;
