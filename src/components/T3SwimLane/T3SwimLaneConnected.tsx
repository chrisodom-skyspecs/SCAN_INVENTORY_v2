/**
 * T3SwimLaneConnected — Convex-wired swim-lane fleet operations board.
 *
 * Sub-AC 2: Wires T3SwimLane to the Convex `getSwimLaneBoard` query,
 * distributing case cards into the correct column and sorting each column's
 * cards by timestamp (most recently active first).
 *
 * Architecture
 * ────────────
 * This component bridges two data models:
 *
 *   Convex backend (8 phases):
 *     hangar → assembled → transit_out → deployed → flagged →
 *     transit_in → received → archived
 *
 *   T3SwimLane presentation (4 columns):
 *     Hangar   → Hangar + Assembled
 *     Carrier  → Transit Out (+ label_created, picked_up, in_transit,
 *                               out_for_delivery when present as case.status)
 *     Field    → Deployed + Flagged
 *     Returning→ Transit In + Received + Archived + Delivered
 *
 * The mapping is handled transparently: this component flattens the 8-phase
 * Convex result into a flat `SwimLaneCase[]`, sorts globally by timestamp,
 * and passes it to T3SwimLane which re-partitions into its 4-column layout
 * using its internal STATUS_TO_COLUMN map.
 *
 * Column distribution algorithm
 * ─────────────────────────────
 * 1. Subscribe to `getSwimLaneBoard` via `useSwimLaneBoard()`.
 * 2. When the board is loaded, flatten all phase lanes into a flat case array.
 * 3. Sort the flat array globally by `mostRecentEventAt ?? updatedAt` descending
 *    (most recently active cases first).
 * 4. Map each `SwimLaneCaseCard` → `SwimLaneCase` (shape required by T3SwimLane):
 *    • id          ← caseId
 *    • label       ← label
 *    • status      ← currentPhase  (SwimLanePhase ⊆ StatusKind — cast is safe)
 *    • location    ← locationName
 *    • assignee    ← assigneeName
 *    • hasDamage   ← phase === "flagged" OR any damage_reported event in phase
 *    • hasShipment ← trackingNumber is set
 * 5. Pass the sorted, mapped array to `<T3SwimLane cases={…} />`.
 *    T3SwimLane re-partitions the flat array into its 4 columns preserving
 *    the sort order — so each column's cards remain timestamp-descending.
 *
 * Loading state
 * ─────────────
 * While `useSwimLaneBoard()` returns `undefined` (initial Convex fetch),
 * `<T3SwimLane isLoading />` is rendered — showing shimmer skeleton cards
 * in all four columns to communicate that data is on the way.
 *
 * Real-time fidelity
 * ──────────────────
 * `useSwimLaneBoard` establishes a live Convex WebSocket subscription.  Any
 * SCAN app mutation that writes to the `cases` or `events` tables triggers
 * Convex to re-evaluate `getSwimLaneBoard` and push a fresh board to this
 * component within ~100–300 ms — satisfying the ≤ 2-second fidelity
 * requirement between SCAN actions and INVENTORY dashboard visibility.
 *
 * Usage
 * ─────
 *   // Full fleet board (all phases)
 *   <T3SwimLaneConnected
 *     selectedCaseId={selectedId}
 *     onSelectCase={setSelectedId}
 *   />
 *
 *   // Mission-scoped board
 *   <T3SwimLaneConnected missionId={activeMission._id} />
 *
 *   // My Cases board — assignee filter + hide archived
 *   <T3SwimLaneConnected
 *     assigneeId={currentUser.id}
 *     excludeArchived
 *   />
 *
 *   // Active phases only (reduced board)
 *   <T3SwimLaneConnected
 *     phases={["transit_out", "deployed", "flagged", "transit_in"]}
 *   />
 */

"use client";

import { useMemo } from "react";
import { T3SwimLane } from "./T3SwimLane";
import type { SwimLaneCase, T3SwimLaneProps } from "./T3SwimLane";
import { SwimLaneErrorBoundary } from "./SwimLaneErrorBoundary";
import type { StatusKind } from "../StatusPill/StatusPill";
import { useSwimLaneBoard } from "@/hooks/use-swim-lane-board";
import type { UseSwimLaneBoardArgs, SwimLaneCaseCard } from "@/hooks/use-swim-lane-board";

// ─── Public props ─────────────────────────────────────────────────────────────

/**
 * Props for `T3SwimLaneConnected`.
 *
 * Combines `UseSwimLaneBoardArgs` (optional Convex query filters) with the
 * subset of `T3SwimLaneProps` that consumers can control.  The `cases` and
 * `isLoading` props are owned internally by this component and not exposed.
 */
export type T3SwimLaneConnectedProps =
  // Remove props owned by the Convex subscription
  Omit<T3SwimLaneProps, "cases" | "isLoading"> &
  // Add Convex filter args
  UseSwimLaneBoardArgs;

// ─── Sort key helper ──────────────────────────────────────────────────────────

/**
 * Sort key for ordering a `SwimLaneCaseCard` within its column.
 *
 * Prefer `mostRecentEventAt` (the timestamp of the most recent swim-lane event
 * in the card's current phase) so that cases with recent activity float to the
 * top.  Fall back to `updatedAt` (last document write timestamp) when no
 * phase events are available (e.g., a brand-new case with no events yet).
 *
 * Both timestamps are epoch-ms integers.  Descending sort: larger = more recent.
 */
function getSortKey(card: SwimLaneCaseCard): number {
  return card.mostRecentEventAt ?? card.updatedAt;
}

// ─── Mapping function ─────────────────────────────────────────────────────────

/**
 * Convert a `SwimLaneCaseCard` (Convex query result) to a `SwimLaneCase`
 * (T3SwimLane presentation shape).
 *
 * The mapping is straightforward: most fields map 1:1 with a name change.
 * Two derived fields add value on top of the raw Convex data:
 *
 *   `hasDamage`   — true when the case is flagged OR has a damage_reported event
 *                   in its current phase (so the damage indicator shows even when
 *                   the case hasn't formally transitioned to "flagged" yet).
 *
 *   `hasShipment` — true when a FedEx tracking number is associated with the
 *                   case (transit_out, transit_in, or any carrier-phase case).
 *
 * `status` is cast from `SwimLanePhase` to `StatusKind`.  The cast is safe
 * because `SwimLanePhase` is a strict subset of `StatusKind` — every swim-lane
 * phase value is a valid `StatusKind`.
 *
 * @param card  A case card from the Convex `getSwimLaneBoard` result.
 * @returns     A `SwimLaneCase` ready for rendering by T3SwimLane.
 */
function toSwimLaneCase(card: SwimLaneCaseCard): SwimLaneCase {
  // Derive damage indicator:
  //   1. The case is in the "flagged" phase (explicitly flagged after inspection)
  //   2. OR: a damage_reported event occurred while the case was in this phase
  //          (damage noted but case hasn't been formally flagged yet)
  const hasDamage =
    card.currentPhase === "flagged" ||
    card.phaseEvents.some((e) => e.eventType === "damage_reported");

  // Derive shipment indicator: case has a FedEx tracking number on record
  const hasShipment = Boolean(card.trackingNumber);

  return {
    id:           card.caseId,
    label:        card.label,
    // SwimLanePhase values are a strict subset of StatusKind — cast is safe.
    // Both types share: hangar, assembled, transit_out, deployed, flagged,
    //                   transit_in, received, archived.
    status:       card.currentPhase as StatusKind,
    location:     card.locationName,
    assignee:     card.assigneeName,
    // Only include boolean fields when they're true to keep the object lean.
    // T3SwimLane treats `undefined` the same as `false` for these fields.
    hasDamage:    hasDamage   ? true : undefined,
    hasShipment:  hasShipment ? true : undefined,
  };
}

// ─── Board flattener and sorter ───────────────────────────────────────────────

/**
 * Flatten a `SwimLaneBoardResult` into a timestamp-sorted `SwimLaneCase[]`.
 *
 * Steps:
 *   1. Flatten: concatenate all case cards from all 8 phase lanes into one array.
 *   2. Sort:    order by getSortKey() descending (most-recently-active first).
 *   3. Map:     convert each SwimLaneCaseCard → SwimLaneCase via toSwimLaneCase.
 *
 * The resulting flat array is passed to T3SwimLane which re-partitions by
 * `status` into 4 columns.  Because the flat array is globally sorted by
 * timestamp, the re-partitioned per-column lists maintain timestamp-descending
 * order automatically — no additional per-column sort is needed.
 *
 * @param board  The Convex board result from `getSwimLaneBoard`.
 * @returns      Flat, timestamp-sorted SwimLaneCase[] ready for T3SwimLane.
 */
function flattenAndSort(
  board: NonNullable<ReturnType<typeof useSwimLaneBoard>>
): SwimLaneCase[] {
  // Collect all cards from all lanes into one flat array.
  // The lanes are already in lifecycle order (hangar → assembled → … → archived)
  // but we sort globally so within-column order is by recency, not lifecycle.
  const allCards: SwimLaneCaseCard[] = [];
  for (const lane of board.lanes) {
    for (const card of lane.cases) {
      allCards.push(card);
    }
  }

  // Sort globally by most-recently-active timestamp descending.
  // Because T3SwimLane partitions by status (preserving flat-array order),
  // each column's subset will also be in timestamp-descending order after
  // re-partitioning.
  allCards.sort((a, b) => getSortKey(b) - getSortKey(a));

  // Map to the shape T3SwimLane expects
  return allCards.map(toSwimLaneCase);
}

// ─── Connected component ──────────────────────────────────────────────────────

/**
 * Convex-wired swim-lane fleet operations board.
 *
 * Subscribes to `getSwimLaneBoard` via `useSwimLaneBoard`, flattens and sorts
 * the result, maps it to `SwimLaneCase[]`, and renders `<T3SwimLane>`.
 *
 * Must be rendered inside a `<ConvexProvider>` (or `<ConvexProviderWithAuth>`).
 * Will render loading skeletons until the initial board fetch completes.
 */
export function T3SwimLaneConnected({
  // Convex filter args — forwarded to useSwimLaneBoard
  missionId,
  assigneeId,
  phases,
  excludeArchived,
  // Remaining T3SwimLane props — forwarded to T3SwimLane
  ...swimLaneProps
}: T3SwimLaneConnectedProps) {
  // ── Live board subscription ────────────────────────────────────────────────
  //
  // `board` is undefined while the initial Convex fetch is in flight.
  // Once connected, Convex pushes fresh board data within ~100–300 ms of any
  // SCAN mutation — satisfying the ≤ 2-second real-time fidelity requirement.
  const board = useSwimLaneBoard({
    missionId:       missionId  ?? undefined,
    assigneeId:      assigneeId ?? undefined,
    phases,
    excludeArchived,
  });

  // ── Data transformation ────────────────────────────────────────────────────
  //
  // `useMemo` gates the flatten + sort + map work so it only runs when the
  // board reference changes (i.e., when Convex pushes a new board snapshot).
  // The transformation is O(n log n) where n = total case count.
  //
  // Produces `undefined` while loading (board is undefined) — T3SwimLane
  // treats `cases === undefined` as equivalent to `isLoading`.
  const cases = useMemo<SwimLaneCase[] | undefined>(() => {
    if (!board) return undefined;
    return flattenAndSort(board);
  }, [board]);

  // ── Render ─────────────────────────────────────────────────────────────────
  //
  // `isLoading` is true while the board has not yet loaded.
  // T3SwimLane also treats `cases === undefined` as loading, but we set both
  // explicitly for clarity and to prevent any flicker when `board` is briefly
  // defined but `cases` memo has not yet run.
  return (
    <T3SwimLane
      {...swimLaneProps}
      cases={cases}
      isLoading={cases === undefined}
    />
  );
}

// ─── Error-boundary-wrapped variant ──────────────────────────────────────────

/**
 * `T3SwimLaneConnectedWithBoundary` — production-ready swim-lane board.
 *
 * Composes `T3SwimLaneConnected` inside a `SwimLaneErrorBoundary` so that any
 * error thrown by the underlying Convex `useQuery` subscription is caught and
 * displayed as the per-column error state rather than crashing the page.
 *
 * This is the **recommended** export for page-level usage.  Use the bare
 * `T3SwimLaneConnected` only when you are managing the error boundary yourself
 * (e.g., when a parent-level boundary already covers this subtree, or in tests
 * where mocking the hook is simpler without a boundary in the tree).
 *
 * Props are identical to `T3SwimLaneConnectedProps` — the boundary is
 * transparent to consumers.
 *
 * @example
 * // Recommended: page-level usage with built-in error handling
 * <T3SwimLaneConnectedWithBoundary
 *   selectedCaseId={selectedId}
 *   onSelectCase={setSelectedId}
 * />
 *
 * @example
 * // Mission-scoped board with error boundary
 * <T3SwimLaneConnectedWithBoundary
 *   missionId={activeMission._id}
 *   selectedCaseId={selectedId}
 *   onSelectCase={setSelectedId}
 * />
 */
export function T3SwimLaneConnectedWithBoundary(
  props: T3SwimLaneConnectedProps
) {
  return (
    <SwimLaneErrorBoundary>
      <T3SwimLaneConnected {...props} />
    </SwimLaneErrorBoundary>
  );
}

// ─── Internal exports for testing ─────────────────────────────────────────────

/**
 * Exported for unit testing only.
 * The `getSortKey`, `toSwimLaneCase`, and `flattenAndSort` functions are
 * pure and synchronous — they can be tested without a Convex runtime.
 *
 * @internal
 */
export { getSortKey, toSwimLaneCase, flattenAndSort };

export default T3SwimLaneConnected;
