/**
 * use-notifications.ts
 *
 * React hook for subscribing to in-app notifications for the authenticated user.
 *
 * Provides:
 *   unreadCount     — reactive count of unread notifications (drives bell badge)
 *   notifications   — paginated list of recent notifications (bell dropdown)
 *   markAsRead      — mutation to mark a single notification as read
 *   markAllAsRead   — mutation to mark all unread notifications as read
 *   isLoading       — true while the initial Convex subscription is pending
 *
 * Both `unreadCount` and `notifications` are live Convex subscriptions —
 * Convex re-evaluates them within ~100–300 ms of any notification row change,
 * satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * The hook skips queries when `userId` is null/undefined (unauthenticated state)
 * to avoid unnecessary Convex round-trips before auth resolves.
 *
 * Usage:
 *   const { unreadCount, notifications, markAllAsRead } = useNotifications(userId);
 */

"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  caseId?: string;
  read: boolean;
  createdAt: number;
}

export interface UseNotificationsResult {
  /** Count of unread notifications — drives the bell badge number. */
  unreadCount: number;
  /** Recent notifications for the dropdown list (newest first). */
  notifications: Notification[];
  /** Mark a single notification as read. */
  markAsRead: (notificationId: string) => Promise<void>;
  /** Mark all unread notifications as read. */
  markAllAsRead: () => Promise<void>;
  /** True while initial subscription is pending (before first Convex response). */
  isLoading: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to in-app notifications for the authenticated user.
 *
 * @param userId  Kinde user ID (the `sub` claim). Pass null/undefined to skip.
 * @param limit   Maximum number of notifications to fetch (default: 20).
 */
export function useNotifications(
  userId: string | null | undefined,
  limit = 20,
): UseNotificationsResult {
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();

  // ── Convex subscriptions ──────────────────────────────────────────────────
  //
  // `skipWhenNoUser` prevents the query from running before userId resolves.
  // Convex's useQuery treats the second argument as "skip" when it is "skip"
  // (the special sentinel from convex/react), but we use the conditional
  // undefined approach which is idiomatic for optional queries.

  const canQuery = Boolean(userId) && isAuthenticated && !isConvexAuthLoading;
  const skipWhenNoUser = canQuery ? { userId } : "skip";
  const skipWithLimit = canQuery ? { userId, limit } : "skip";

  // Unread count — reactive badge number
  const rawUnreadCount = useQuery(
    api.notifications.getUnreadCount,
    skipWhenNoUser as { userId: string } | "skip",
  );

  // Notification list — dropdown content
  const rawNotifications = useQuery(
    api.notifications.listNotifications,
    skipWithLimit as { userId: string; limit?: number } | "skip",
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const markAsReadMutation = useMutation(api.notifications.markAsRead);
  const markAllAsReadMutation = useMutation(api.notifications.markAllAsRead);

  // ── Derived state ─────────────────────────────────────────────────────────

  const isLoading =
    isConvexAuthLoading ||
    (canQuery && (rawUnreadCount === undefined || rawNotifications === undefined));
  const unreadCount = rawUnreadCount ?? 0;
  const notifications: Notification[] = (rawNotifications ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    caseId: n.caseId,
    read: n.read,
    createdAt: n.createdAt,
  }));

  // ── Stable mutation callbacks ─────────────────────────────────────────────

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!userId) return;
      await markAsReadMutation({
        notificationId: notificationId as Id<"notifications">,
        userId,
      });
    },
    [markAsReadMutation, userId],
  );

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    await markAllAsReadMutation({ userId });
  }, [markAllAsReadMutation, userId]);

  return {
    unreadCount,
    notifications,
    markAsRead,
    markAllAsRead,
    isLoading,
  };
}
