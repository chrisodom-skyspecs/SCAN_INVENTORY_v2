/**
 * src/hooks/use-server-state-reconciliation.ts
 *
 * Sub-AC 2c: Server-state reconciliation for the SCAN mobile app.
 *
 * Purpose
 * ───────
 * The SCAN app uses Convex's `withOptimisticUpdate` (Sub-AC 2b) to immediately
 * reflect mutation results in the local query store before the server round-trip
 * completes.  In the normal case, the server confirms a result identical to the
 * optimistic prediction and the user never notices the two-phase write.
 *
 * Divergence can occur when:
 *   • A concurrent mutation from another device/user changed the document
 *     between the optimistic update and the server write — the server sees a
 *     different pre-condition than the client assumed.
 *   • The server applies normalisation or computed fields that differ from the
 *     client's prediction (e.g., the client predicted "transit_out" for a case
 *     already returned to base, but the server computed "transit_in" from the
 *     authoritative record).
 *   • A network delay caused a long round-trip, during which the local
 *     optimistic state was visible to the user but ultimately didn't match
 *     the server outcome.
 *
 * Reconciliation strategy
 * ───────────────────────
 * 1. Before each mutation, call `trackMutation(id, predictions)` to record
 *    which field values the optimistic update applied.
 *
 * 2. After the mutation Promise resolves (success), call
 *    `confirmMutation(id, serverValues)` with the actual values returned by
 *    the server.  The hook compares server values against predictions and
 *    records any diverged fields.
 *
 * 3. If the mutation throws (failure), Convex automatically rolls back the
 *    optimistic update.  Call `cancelMutation(id)` — no divergence, but the
 *    component shows its own error message.
 *
 * 4. When `hasDivergence === true`, render a <ReconciliationBanner /> that
 *    explains which fields differed and lets the user dismiss the notice.
 *
 * 5. When `isStale === true`, a mutation has been pending for longer than
 *    STALE_THRESHOLD_MS without server confirmation — likely a connectivity
 *    issue.  The banner surfaces this separately so the user knows their action
 *    may not have been persisted.
 *
 * Integration pattern
 * ───────────────────
 *   const reconciliation = useServerStateReconciliation();
 *
 *   async function handleSubmit() {
 *     const mutId = `check-in-${Date.now()}`;
 *     reconciliation.trackMutation(mutId, { status: selectedStatus });
 *     try {
 *       const result = await checkIn({ caseId, status: selectedStatus, ... });
 *       reconciliation.confirmMutation(mutId, { status: result.newStatus });
 *     } catch {
 *       reconciliation.cancelMutation(mutId);
 *       // Display error via component-local state
 *     }
 *   }
 *
 *   // In JSX:
 *   {reconciliation.hasDivergence && (
 *     <ReconciliationBanner
 *       divergedFields={reconciliation.divergedFields}
 *       onDismiss={reconciliation.dismiss}
 *     />
 *   )}
 *   {reconciliation.isStale && (
 *     <ReconciliationBanner stale onDismiss={reconciliation.dismiss} />
 *   )}
 *
 * Design decisions
 * ────────────────
 * • Uses a `useRef` for the pending-mutations map to avoid re-renders when
 *   mutations are tracked/cancelled without state changes.
 * • Stale detection runs on a setInterval so it does not require any external
 *   input to trigger (independent of mutation Promise resolution).
 * • The hook is stateless across renders in the sense that dismissal clears
 *   diverged fields — the user has acknowledged the discrepancy and the banner
 *   disappears until a new divergence is detected.
 * • `shallowEqual` is intentionally simple: all fields we compare are scalar
 *   (strings, numbers, undefined).  Deep equality would be over-engineered.
 */

"use client";

import { useRef, useState, useCallback, useEffect } from "react";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A single field-level divergence between the optimistic prediction and the
 * server-confirmed value.
 */
export interface DivergenceRecord {
  /**
   * The field name that diverged (e.g. "status", "assigneeId", "carrier").
   * Matches the key used in `predictions` when `trackMutation` was called.
   */
  field: string;
  /**
   * The value predicted by the optimistic update.
   * May be `undefined` if the optimistic update chose not to predict this field.
   */
  predicted: unknown;
  /**
   * The actual value confirmed by the server after the mutation resolved.
   */
  actual: unknown;
}

/**
 * Public API returned by `useServerStateReconciliation`.
 *
 * Consumers use `trackMutation` / `confirmMutation` / `cancelMutation` to
 * drive the lifecycle, and read `hasDivergence` / `isStale` for rendering
 * decisions.
 */
export interface ReconciliationResult {
  /**
   * True when at least one field in the most recent confirmed mutation diverged
   * from its optimistic prediction and the user has not yet dismissed the banner.
   *
   * Reset to `false` when `dismiss()` is called.
   */
  hasDivergence: boolean;

  /**
   * The list of field-level divergences from the most recent confirmation.
   * Empty array when `hasDivergence` is false.
   */
  divergedFields: DivergenceRecord[];

  /**
   * True when one or more mutations have been pending for longer than
   * `STALE_THRESHOLD_MS` without server confirmation.
   *
   * Indicates a possible connectivity problem.  The local optimistic state is
   * shown to the user, but the server may not have persisted the mutation yet.
   */
  isStale: boolean;

  /**
   * Epoch milliseconds when the first stale mutation was detected.
   * `null` when there are no stale mutations.
   */
  staleSince: number | null;

  /**
   * Number of mutations currently in flight (tracked but not yet confirmed or
   * cancelled).
   *
   * > 0 means at least one Convex round-trip is pending.
   */
  pendingCount: number;

  /**
   * Dismiss the divergence banner.
   *
   * Clears `divergedFields` and sets `hasDivergence` to false.  The user has
   * acknowledged the discrepancy; the banner disappears until a new divergence
   * is detected from the next mutation.
   */
  dismiss: () => void;

  /**
   * Register a mutation's field-level optimistic predictions before calling
   * the Convex mutation function.
   *
   * Call this synchronously before `await mutation(args)`.  The predictions
   * mirror what the `withOptimisticUpdate` callback wrote into the local store.
   *
   * @param id          Unique mutation run ID (e.g. `"check-in-${Date.now()}"`)
   * @param predictions Field → predicted value map
   */
  trackMutation: (id: string, predictions: Record<string, unknown>) => void;

  /**
   * Compare server-confirmed values against the tracked predictions.
   *
   * Call this immediately after the mutation Promise resolves successfully.
   * If any predicted field value differs from the server-confirmed value, the
   * hook sets `hasDivergence = true` and populates `divergedFields`.
   *
   * @param id           The mutation run ID passed to `trackMutation`
   * @param serverValues Field → server-confirmed value map (from mutation result
   *                     or the post-mutation query snapshot)
   */
  confirmMutation: (id: string, serverValues: Record<string, unknown>) => void;

  /**
   * Remove a pending mutation record without checking for divergence.
   *
   * Call this in the catch block when the mutation throws.  Convex
   * automatically rolls back the optimistic update on failure, so the local
   * store is cleanly restored — no divergence to surface.  The component
   * handles the failure by showing its own error message.
   *
   * @param id The mutation run ID passed to `trackMutation`
   */
  cancelMutation: (id: string) => void;
}

// ─── Internal types ───────────────────────────────────────────────────────────

/** Internal tracking record for a single pending mutation. */
interface PendingMutation {
  id: string;
  startedAt: number;
  predictions: Record<string, unknown>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Time in milliseconds before a pending mutation is considered stale.
 *
 * Normal Convex round-trips are ~100–300 ms.  5 000 ms is chosen to be
 * well above that baseline while remaining short enough to alert users to
 * real connectivity problems (slow cellular, offline, server overload).
 */
export const STALE_THRESHOLD_MS = 5_000;

/**
 * Interval at which stale-mutation detection runs.
 * 1 s provides timely alerts without excessive polling overhead.
 */
const STALE_CHECK_INTERVAL_MS = 1_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Shallow equality for scalar values and single-depth plain objects.
 *
 * The fields we compare in reconciliation (status strings, user IDs, tracking
 * numbers, timestamps) are always primitives — deep recursion is not needed.
 *
 * Returns `true` when the two values are considered equal.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  // Strict equality covers primitives (string, number, boolean, null, undefined)
  // and object identity.
  if (a === b) return true;

  // Different types → not equal.
  if (typeof a !== typeof b) return false;

  // null check (typeof null === "object")
  if (a === null || b === null) return false;

  // Both are non-null objects — do a one-level key comparison.
  if (typeof a === "object") {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => objA[k] === objB[k]);
  }

  return false;
}

/**
 * Compare `predictions` against `serverValues` and return an array of records
 * describing each diverged field.
 *
 * Only compares fields that appear in both maps — fields present in
 * `predictions` but absent in `serverValues` are skipped (the server chose not
 * to return that field, so we cannot determine whether it diverged).
 */
export function detectDivergence(
  predictions: Record<string, unknown>,
  serverValues: Record<string, unknown>,
): DivergenceRecord[] {
  const diverged: DivergenceRecord[] = [];

  for (const [field, predicted] of Object.entries(predictions)) {
    if (!(field in serverValues)) continue;
    const actual = serverValues[field];
    if (!shallowEqual(predicted, actual)) {
      diverged.push({ field, predicted, actual });
    }
  }

  return diverged;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useServerStateReconciliation`
 *
 * Detects and surfaces divergence between optimistic local state and the
 * confirmed Convex server state for SCAN app mutations.
 *
 * See module-level JSDoc for full usage documentation and integration pattern.
 *
 * @returns ReconciliationResult
 */
export function useServerStateReconciliation(): ReconciliationResult {
  // ── Mutable pending-mutations map ─────────────────────────────────────────
  // Stored in a ref so tracking / cancelling mutations doesn't trigger
  // re-renders on its own — only state changes that affect the UI do.
  const pendingRef = useRef<Map<string, PendingMutation>>(new Map());

  // ── React state (drives UI re-renders) ────────────────────────────────────
  const [divergedFields, setDivergedFields] = useState<DivergenceRecord[]>([]);
  const [dismissed, setDismissed] = useState(false);

  // pendingCount as React state so consumers re-render when mutations are
  // tracked/confirmed/cancelled (pendingRef changes don't trigger re-renders).
  const [pendingCount, setPendingCount] = useState(0);

  // Stale mutation tracking: list of IDs that exceeded STALE_THRESHOLD_MS.
  const [staleMutationIds, setStaleMutationIds] = useState<string[]>([]);
  // The epoch-ms timestamp when stale state was first observed (for display).
  const [firstStaleAt, setFirstStaleAt] = useState<number | null>(null);

  // ── Stale detection interval ──────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      if (pendingRef.current.size === 0) return;

      const now = Date.now();
      const nextStaleIds: string[] = [];

      pendingRef.current.forEach((mutation, id) => {
        if (now - mutation.startedAt >= STALE_THRESHOLD_MS) {
          nextStaleIds.push(id);
        }
      });

      // Update state only when the stale set changes — avoids unnecessary
      // re-renders on every interval tick.
      setStaleMutationIds((prev) => {
        const prevSet = new Set(prev);
        const nextSet = new Set(nextStaleIds);
        const changed =
          prev.length !== nextStaleIds.length ||
          nextStaleIds.some((id) => !prevSet.has(id)) ||
          prev.some((id) => !nextSet.has(id));
        return changed ? nextStaleIds : prev;
      });

      // Record first-stale timestamp (never reset while mutations remain stale).
      setFirstStaleAt((prev) => {
        if (nextStaleIds.length > 0 && prev === null) return now;
        if (nextStaleIds.length === 0 && prev !== null) return null;
        return prev;
      });
    }, STALE_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  // ── trackMutation ─────────────────────────────────────────────────────────

  const trackMutation = useCallback(
    (id: string, predictions: Record<string, unknown>): void => {
      pendingRef.current.set(id, {
        id,
        startedAt: Date.now(),
        predictions,
      });
      setPendingCount(pendingRef.current.size);
      // A new mutation starting means the user took a fresh action — reset
      // dismissed state so any new divergence will be visible.
      setDismissed(false);
    },
    [],
  );

  // ── confirmMutation ───────────────────────────────────────────────────────

  const confirmMutation = useCallback(
    (id: string, serverValues: Record<string, unknown>): void => {
      const pending = pendingRef.current.get(id);
      if (!pending) return;

      // Remove from pending (mutation has resolved).
      pendingRef.current.delete(id);
      setPendingCount(pendingRef.current.size);
      setStaleMutationIds((prev) => prev.filter((sid) => sid !== id));
      if (pendingRef.current.size === 0) {
        setFirstStaleAt(null);
      }

      // ── Divergence detection ───────────────────────────────────────────────
      const diverged = detectDivergence(pending.predictions, serverValues);

      if (diverged.length > 0) {
        // Replace any previous divergence record with the latest one.
        // (Multiple rapid mutations: show the most recent divergence.)
        setDivergedFields(diverged);
        setDismissed(false);
      }
      // If no divergence, leave existing divergedFields unchanged — the user
      // may not have dismissed a previous divergence banner yet.
    },
    [],
  );

  // ── cancelMutation ────────────────────────────────────────────────────────

  const cancelMutation = useCallback((id: string): void => {
    pendingRef.current.delete(id);
    setPendingCount(pendingRef.current.size);
    setStaleMutationIds((prev) => prev.filter((sid) => sid !== id));
    if (pendingRef.current.size === 0) {
      setFirstStaleAt(null);
    }
    // Do NOT touch divergedFields — the mutation failed and Convex rolled back
    // the optimistic update automatically.  The component shows an error
    // message; no reconciliation banner is needed.
  }, []);

  // ── dismiss ───────────────────────────────────────────────────────────────

  const dismiss = useCallback((): void => {
    setDivergedFields([]);
    setDismissed(true);
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const hasDivergence = !dismissed && divergedFields.length > 0;
  const isStale = staleMutationIds.length > 0;

  return {
    hasDivergence,
    divergedFields,
    isStale,
    staleSince: isStale ? firstStaleAt : null,
    // pendingCount is React state (tracked alongside the ref) so components
    // re-render when mutations enter or leave the pending set.
    pendingCount,
    dismiss,
    trackMutation,
    confirmMutation,
    cancelMutation,
  };
}
