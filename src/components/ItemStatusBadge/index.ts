/**
 * ItemStatusBadge — public exports
 *
 * Status indicator UI primitives for manifest item inspection states.
 *
 * Components:
 *   ItemStatusBadge     — icon + label + count badge for a single state
 *   InspectionStatusBar — horizontal row of status badges (multi-state summary)
 *   ItemStatusIcon      — icon-only indicator (no label, no count)
 *
 * Types:
 *   ItemInspectionStatus  — "verified" | "flagged" | "missing" | "unchecked"
 *   ItemStatusBadgeProps
 *   InspectionStatusBarProps
 *   ItemStatusIconProps
 */
export {
  ItemStatusBadge,
  InspectionStatusBar,
  ItemStatusIcon,
} from "./ItemStatusBadge";

export type {
  ItemInspectionStatus,
  ItemStatusBadgeProps,
  InspectionStatusBarProps,
  ItemStatusIconProps,
} from "./ItemStatusBadge";
