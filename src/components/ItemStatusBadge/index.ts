/**
 * ItemStatusBadge — public exports
 *
 * Status indicator UI primitives for manifest item inspection states.
 *
 * Components:
 *   ItemStatusBadge       — icon + label + count badge for a single state
 *   InspectionStatusBar   — horizontal row of status badges (multi-state summary)
 *   ItemStatusIcon        — icon-only indicator (no label, no count)
 *   ChecklistStatusCounts — derives + displays aggregate counts from an item list
 *
 * Types:
 *   ItemInspectionStatus      — "verified" | "flagged" | "missing" | "unchecked"
 *   StatusCountItem           — minimal duck-typed item shape for ChecklistStatusCounts
 *   ItemStatusBadgeProps
 *   InspectionStatusBarProps
 *   ItemStatusIconProps
 *   ChecklistStatusCountsProps
 */
export {
  ItemStatusBadge,
  InspectionStatusBar,
  ItemStatusIcon,
  ChecklistStatusCounts,
} from "./ItemStatusBadge";

export type {
  ItemInspectionStatus,
  StatusCountItem,
  ItemStatusBadgeProps,
  InspectionStatusBarProps,
  ItemStatusIconProps,
  ChecklistStatusCountsProps,
} from "./ItemStatusBadge";
