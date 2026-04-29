/**
 * src/hooks/use-swim-lane-board.ts
 *
 * React hook for subscribing to the INVENTORY swim-lane board via Convex
 * real-time subscriptions.
 *
 * This hook wraps `api["queries/swimLanes"].getSwimLaneBoard` and exposes
 * optional filter arguments so consumers can scope the board to a specific
 * mission, assignee, lifecycle phase subset, or exclude archived cases.
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates the subscription within ~100–300 ms whenever:
 *   • Any SCAN mutation writes to the `cases` table (status change, check-in)
 *   • Any SCAN mutation appends a new `events` row (inspection, damage, ship)
 * Both table writes are reactive dependencies tracked by the server-side
 * getSwimLaneBoard handler — satisfying the ≤ 2-second real-time requirement.
 *
 * Return states
 * ─────────────
 *   `undefined`          — loading (initial fetch or WebSocket reconnect)
 *   `SwimLaneBoardResult` — live swim-lane board data
 *   (never null — the query always returns a full board result shape)
 *
 * Skip semantics
 * ──────────────
 * All filter args are optional.  The hook always subscribes (there is no skip
 * trigger for the board-level query) because the board always has a meaningful
 * result: 8 empty lanes when no cases exist.
 *
 * Usage
 * ─────
 *   // Full fleet board (all phases, all cases)
 *   const board = useSwimLaneBoard();
 *   if (!board) return <SwimLaneSkeleton />;
 *
 *   // Mission-scoped board
 *   const board = useSwimLaneBoard({ missionId: selectedMission._id });
 *
 *   // My Cases board (exclude archived)
 *   const board = useSwimLaneBoard({
 *     assigneeId: currentUser.id,
 *     excludeArchived: true,
 *   });
 *
 *   // Active phases only
 *   const board = useSwimLaneBoard({
 *     phases: ["transit_out", "deployed", "flagged", "transit_in"],
 *   });
 *
 * @module
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { SwimLaneBoardResult, SwimLanePhase } from "../../convex/queries/swimLanes";

// Re-export types so consumers of this hook don't need a separate Convex import.
export type {
  SwimLaneBoardResult,
  SwimLanePhase,
  SwimLaneBucket,
  SwimLaneCaseCard,
  CasePhaseEvent,
  SwimLaneEventMetadata,
  StatusChangeMetadata,
  InspectionMetadata,
  DamageMetadata,
  ShippingMetadata,
  CustodyMetadata,
  MissionMetadata,
  TemplateMetadata,
  GenericMetadata,
} from "../../convex/queries/swimLanes";

// ─── Swim-lane API accessor ───────────────────────────────────────────────────

/**
 * Dynamic key accessor for the swim-lane query module.
 *
 * The generated api.d.ts does not yet include "queries/swimLanes" because the
 * Convex development server has not been restarted since the module was added.
 * This follows the same pattern used by other sub-module query hooks in this
 * codebase (use-case-events.ts, use-m2-journey-stops.ts, use-custody.ts).
 *
 * Safe: optional-chaining ensures the hook degrades gracefully (returns
 * undefined) when running in a test environment where the API is not fully
 * initialised.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const swimLanesApi = (api as unknown as Record<string, Record<string, unknown>>)[
  "queries/swimLanes"
];

// ─── Arg types ────────────────────────────────────────────────────────────────

/**
 * Optional filter arguments for `useSwimLaneBoard`.
 *
 * All fields are optional.  Multiple filters apply cumulatively (AND logic on
 * the server).  Omit all fields for the global (unfiltered) fleet board.
 */
export interface UseSwimLaneBoardArgs {
  /**
   * Scope the board to cases assigned to a specific deployment mission.
   * Uses the server-side by_mission index for efficient scoped queries.
   * Pass null or omit to show all missions (global board).
   */
  missionId?: string | null;

  /**
   * Filter cases to those assigned to a specific technician (Kinde user ID).
   * Applied in-memory on the server after the cases table scan.
   * Pass null or omit to show all assignees.
   */
  assigneeId?: string | null;

  /**
   * Restrict the board to specific lifecycle phase columns.
   * When provided, only the requested phase lanes appear in the result.
   * Useful for partial-board views (e.g., field-active phases only).
   *
   * @example
   * // Show only field-active cases
   * phases: ["transit_out", "deployed", "flagged", "transit_in"]
   */
  phases?: SwimLanePhase[];

  /**
   * When true, exclude the "archived" phase lane from the result.
   * Convenience flag for boards that should not show decommissioned cases.
   * Default: false (archived lane is included).
   */
  excludeArchived?: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to the INVENTORY swim-lane board via a live Convex subscription.
 *
 * Returns the full `SwimLaneBoardResult` — 8 lifecycle phase lanes (or fewer
 * when phase/archived filters are applied), each containing:
 *   • All cases currently in that phase as `SwimLaneCaseCard` objects
 *   • Per-card phase events (events that occurred while the case was in that phase)
 *   • Column-level aggregates: caseCount, eventCount
 *
 * The result is `undefined` while the initial fetch is in flight.  Components
 * should render a loading skeleton when the board is undefined.
 *
 * Real-time updates:
 * Convex automatically re-evaluates and pushes a fresh board within ~100–300 ms
 * of any SCAN app mutation (scan.scanCheckIn, custody.handoffCustody,
 * shipping.shipCase, etc.) that writes to the `cases` or `events` tables.
 * This satisfies the ≤ 2-second real-time fidelity requirement between SCAN
 * app actions and the INVENTORY dashboard swim-lane view.
 *
 * @param args  Optional filter args.  All fields are optional.
 *              Pass no args (or an empty object) for the global fleet board.
 * @returns     `SwimLaneBoardResult` when live data is available, `undefined`
 *              while loading.
 *
 * @example
 * // Global fleet board — all phases, all cases
 * const board = useSwimLaneBoard();
 * if (!board) return <T3SwimLane isLoading />;
 *
 * // Mission-scoped board (M2 Mission Mode)
 * const board = useSwimLaneBoard({ missionId: selectedMission._id });
 *
 * // My cases only, excluding archived
 * const board = useSwimLaneBoard({
 *   assigneeId: kindeUser.id,
 *   excludeArchived: true,
 * });
 */
export function useSwimLaneBoard(
  args: UseSwimLaneBoardArgs = {}
): SwimLaneBoardResult | undefined {
  const { missionId, assigneeId, phases, excludeArchived } = args;

  // Build the query args object, omitting undefined/null fields so Convex
  // treats them as absent rather than explicitly set to null.
  const queryArgs: Record<string, unknown> = {};
  if (missionId != null)          queryArgs.missionId       = missionId;
  if (assigneeId != null)         queryArgs.assigneeId      = assigneeId;
  if (phases && phases.length > 0) queryArgs.phases         = phases;
  if (excludeArchived !== undefined) queryArgs.excludeArchived = excludeArchived;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useQuery(
    swimLanesApi?.["getSwimLaneBoard"] as Parameters<typeof useQuery>[0],
    queryArgs,
  );

  return result as SwimLaneBoardResult | undefined;
}
