/**
 * ManifestPanel — barrel export.
 *
 * Container component that fetches and renders manifest items (packing list)
 * for a case in real-time via Convex subscriptions.
 *
 * Named `ManifestPanel` to distinguish it from the T2Manifest tab layout
 * inside CaseDetailPanel.  ManifestPanel is a standalone container that
 * can be embedded in any context (dashboard panels, SCAN app views, etc.).
 *
 * Status vocabulary exposed to users:
 *   "Verified" → item confirmed present and undamaged (data: "ok")
 *   "Flagged"  → item has documented issues          (data: "damaged")
 *   "Missing"  → item not found in case              (data: "missing")
 */

export { ManifestPanel } from "./ManifestPanel";
export type { ManifestPanelProps } from "./ManifestPanel";
