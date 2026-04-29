/**
 * TimelineEvent — barrel export.
 *
 * Re-exports the TimelineEvent component and all associated types and
 * vocabulary maps so consumers can import everything from a single path.
 *
 * @example
 *   import { TimelineEvent } from "@/components/TimelineEvent";
 *   import type { TimelineEventProps, DotVariant } from "@/components/TimelineEvent";
 */

export { TimelineEvent, formatEventType, EVENT_TYPE_LABELS, EVENT_DOT_VARIANTS } from "./TimelineEvent";
export type { TimelineEventProps, DotVariant, EventLocation, EventPosition } from "./TimelineEvent";
export { default } from "./TimelineEvent";
