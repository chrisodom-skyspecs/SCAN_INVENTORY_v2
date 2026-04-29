/**
 * ReconciliationBanner barrel export.
 *
 * Sub-AC 2c: SCAN app server-state reconciliation notice component.
 *
 * Renders a banner when:
 *   • The Convex server confirmed field values that differ from the optimistic
 *     prediction made by `useServerStateReconciliation` (divergence variant).
 *   • A mutation has been pending longer than STALE_THRESHOLD_MS without
 *     server confirmation (stale variant).
 *
 * @see src/hooks/use-server-state-reconciliation.ts for the data source hook.
 */

export { ReconciliationBanner } from "./ReconciliationBanner";
export type { ReconciliationBannerProps } from "./ReconciliationBanner";
