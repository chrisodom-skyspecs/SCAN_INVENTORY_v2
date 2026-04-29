/**
 * T3SwimLane — Public exports
 *
 * Four-column swim-lane fleet operations board for the INVENTORY dashboard.
 * Columns: Hangar | Carrier | Field | Returning
 *
 * T3SwimLane             — pure presentation component; accepts pre-fetched
 *                          SwimLaneCase[] as a prop.
 *
 * T3SwimLaneConnected    — Convex-wired container; subscribes to
 *                          getSwimLaneBoard, maps the 8-phase result to
 *                          4-column layout, sorts cards by timestamp, and
 *                          renders T3SwimLane.  Requires a ConvexProvider
 *                          ancestor in the tree.
 */

export { T3SwimLane } from "./T3SwimLane";
export type {
  SwimLaneCase,
  SwimLaneColumnId,
  T3SwimLaneProps,
} from "./T3SwimLane";

export { T3SwimLaneConnected } from "./T3SwimLaneConnected";
export type { T3SwimLaneConnectedProps } from "./T3SwimLaneConnected";
