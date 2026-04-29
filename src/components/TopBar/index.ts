/**
 * TopBar component exports
 *
 * TopBar              — 52px fixed top bar shell (logo + live indicator + bell + avatar)
 * ConnectionIndicator — pulsing dot tied to Convex WebSocket connection state
 * NotificationBell    — bell icon with unread-count badge and notification dropdown
 */

export { TopBar } from "./TopBar";
export type { TopBarProps } from "./TopBar";

export { ConnectionIndicator } from "./ConnectionIndicator";
export type { ConnectionIndicatorProps } from "./ConnectionIndicator";

export { NotificationBell } from "./NotificationBell";
export type { NotificationBellProps } from "./NotificationBell";
