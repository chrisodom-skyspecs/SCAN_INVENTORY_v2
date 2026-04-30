/**
 * src/hooks/use-missions.ts
 *
 * Convex `useQuery` hooks for real-time mission data subscriptions.
 *
 * Architecture
 * ────────────
 * Each hook wraps `useQuery` (from convex/react) and subscribes to the
 * corresponding public query function in convex/missions.ts.
 * Convex re-pushes updates within ~100–300 ms of any mission change.
 *
 * Missions represent field deployment groups.  They appear as the "organisation"
 * filter in the M1/M2 map toolbar (each mission is an operational deployment
 * that cases are assigned to) and as M2 grouping headers in the mission map
 * mode sidebar.
 *
 * Skip pattern
 * ────────────
 * Hooks that accept nullable IDs use `"skip"` when the value is null to
 * suppress the subscription entirely.
 *
 * Available hooks:
 *   useMissions()                    — all missions (for org filter dropdowns)
 *   useActiveMissions()              — active missions only
 *   useMissionById(missionId)        — single mission document
 *
 * Usage:
 *   // Org filter dropdown in M1/M2 toolbar:
 *   const { orgs } = useMissions();
 *   // orgs: Array<{ id: string; name: string }>
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Re-export types so consumers can import them from the hook module.
export type {
  MissionSummary,
  MissionStatus,
} from "../../convex/missions";

interface UseMissionQueryOptions {
  enabled?: boolean;
}

// ─── useMissions ──────────────────────────────────────────────────────────────

/**
 * Subscribe to all missions.
 *
 * Returns the mission list and a derived `orgs` array suitable for the
 * M1/M2 map toolbar mission / "organisation" filter dropdown.
 *
 * Convex re-runs this query and pushes updates whenever a mission is
 * created, updated, or cancelled.
 *
 * Return values:
 *   `missions`   — `undefined` while loading; `MissionSummary[]` when ready
 *   `orgs`       — derived `{ id: string; name: string }[]` for dropdown props
 *   `isLoading`  — true while missions is undefined (initial load)
 *
 * @example
 * function MissionFilterDropdown() {
 *   const { orgs, isLoading } = useMissions();
 *   if (isLoading) return <Skeleton />;
 *   return <OrgSelect orgs={orgs} />;
 * }
 */
export function useMissions(options: UseMissionQueryOptions = {}) {
  const { enabled = true } = options;
  const missions = useQuery(
    api.missions.listMissions,
    enabled ? {} : "skip"
  );

  const orgs: Array<{ id: string; name: string }> =
    missions?.map((m: { _id: string; name: string }) => ({ id: m._id, name: m.name })) ?? [];

  return {
    missions,
    orgs,
    isLoading: missions === undefined,
  };
}

// ─── useActiveMissions ────────────────────────────────────────────────────────

/**
 * Subscribe to active missions only.
 *
 * Useful for M2 side panel where only ongoing deployments are shown,
 * or for SCAN app mission assignment where only active missions are selectable.
 *
 * Return values:
 *   `missions`   — `undefined` while loading; active `MissionSummary[]` when ready
 *   `orgs`       — derived `{ id: string; name: string }[]` for dropdown props
 *   `isLoading`  — true while missions is undefined
 *
 * @example
 * function ActiveMissionList() {
 *   const { missions, isLoading } = useActiveMissions();
 *   if (isLoading) return <Skeleton />;
 *   return <MissionList missions={missions ?? []} />;
 * }
 */
export function useActiveMissions(options: UseMissionQueryOptions = {}) {
  const { enabled = true } = options;
  const missions = useQuery(
    api.missions.listMissions,
    enabled ? { status: "active" } : "skip"
  );

  const orgs: Array<{ id: string; name: string }> =
    missions?.map((m: { _id: string; name: string }) => ({ id: m._id, name: m.name })) ?? [];

  return {
    missions,
    orgs,
    isLoading: missions === undefined,
  };
}

// ─── useMissionById ───────────────────────────────────────────────────────────

/**
 * Subscribe to a single mission by its Convex ID.
 *
 * Used when:
 *   • Drilling into a mission from the M2 sidebar
 *   • Displaying mission metadata in the case detail T1/T2 panels
 *   • Case assignment workflow — show selected mission name + location
 *
 * Pass `null` as `missionId` to skip the subscription.
 *
 * Return values:
 *   `undefined`       — loading
 *   `null`            — mission not found
 *   `MissionSummary`  — live mission data
 *
 * @example
 * function MissionBadge({ missionId }: { missionId: string | null }) {
 *   const mission = useMissionById(missionId);
 *   if (mission === undefined) return <Skeleton />;
 *   if (mission === null) return null;
 *   return <span>{mission.name}</span>;
 * }
 */
export function useMissionById(
  missionId: string | null,
  options: UseMissionQueryOptions = {}
) {
  const { enabled = true } = options;
  return useQuery(
    api.missions.getMissionById,
    enabled && missionId !== null ? { missionId: missionId as Id<"missions"> } : "skip",
  );
}
