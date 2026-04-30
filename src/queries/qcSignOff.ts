/**
 * src/queries/qcSignOff.ts
 *
 * Canonical import path for real-time QC (quality-control) sign-off
 * subscription hooks.
 *
 * All components that need live QC sign-off state should import from here.
 * This module is the stable public API for QC query hooks — it re-exports
 * everything from the underlying hook implementation in
 * `src/hooks/use-qc-sign-off.ts`.
 *
 * Architecture
 * ────────────
 * The hook file (`src/hooks/use-qc-sign-off.ts`) is the single source of
 * truth for the `useQuery` wiring.  This module provides the canonical
 * "queries/" import path for components that follow the project convention:
 *
 *   import { useQcSignOffByCaseId } from "@/queries/qcSignOff";
 *
 * Convex reactive transport delivers updates to all subscribed clients within
 * ~100–300 ms of any `submitQcSignOff` / `addQcSignOff` mutation — no polling,
 * no manual refetching — satisfying the ≤ 2-second real-time fidelity
 * requirement between SCAN app actions and INVENTORY dashboard visibility.
 *
 * Available hooks
 * ───────────────
 * useQcSignOffByCaseId(caseId)
 *   Latest QC sign-off record for one case.  Returns null when no decision
 *   has been recorded.  PRIMARY hook for the T3 QC Sign-off form
 *   `currentStatus` prop and the T1 Summary panel QC status badge.
 *   Updates within ~100–300 ms of any sign-off mutation for this case.
 *
 * useQcSignOffHistory(caseId, limit?)
 *   Full QC history for a case, newest first.  Used by the T5 Audit panel
 *   QC history section.  Optionally bounded by `limit` for paginated views.
 *
 * useQcSignOffsByStatus(status, limit?)
 *   Fleet-wide sign-offs filtered by status ("pending" | "approved" |
 *   "rejected").  Used by the QC review queue on the INVENTORY dashboard.
 *
 * useQcSignOffsByCaseIds(caseIds)
 *   Batch lookup of latest QC state for up to 50 cases at once.  Used by
 *   the M1 fleet overview map to show QC badges on many pins without
 *   issuing N separate subscriptions.
 *
 * Type exports
 * ────────────
 * QcSignOffStatus
 *   "pending" | "approved" | "rejected"
 *
 * QcSignOffRecord
 *   Shape of a single qcSignOffs table row returned from Convex queries.
 *
 * QcSignOffByCaseIdEntry
 *   Shape of a single { caseId, signOff } entry from useQcSignOffsByCaseIds.
 *
 * Example — T3 Inspection panel QC status wiring:
 *
 *   import { useQcSignOffByCaseId } from "@/queries/qcSignOff";
 *
 *   const signOff = useQcSignOffByCaseId(caseId);
 *   // signOff === undefined  → loading; show skeleton
 *   // signOff === null       → no prior decision
 *   // signOff.status         → "pending" | "approved" | "rejected"
 *
 * Example — T5 Audit panel QC history:
 *
 *   import { useQcSignOffHistory } from "@/queries/qcSignOff";
 *
 *   const history = useQcSignOffHistory(caseId);
 *   // history[0] → most recent sign-off
 *   // history[N-1] → earliest sign-off
 */

// Re-export all hooks and types from the canonical hook implementation.
// The hook file is the single source of truth for the useQuery wiring;
// this module provides the stable "queries/" import path for components.
export {
  useQcSignOffByCaseId,
  useQcSignOffHistory,
  useQcSignOffsByStatus,
  useQcSignOffsByCaseIds,
} from "../hooks/use-qc-sign-off";

export type {
  QcSignOffStatus,
  QcSignOffRecord,
  QcSignOffByCaseIdEntry,
} from "../hooks/use-qc-sign-off";
