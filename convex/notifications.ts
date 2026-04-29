/**
 * convex/notifications.ts
 *
 * In-app notification queries for the INVENTORY dashboard and SCAN mobile app.
 *
 * All notifications are in-app only — no push notifications, no email.
 * The bell icon in the top bar subscribes to the unread count via
 * `getUnreadCount`; the full notification list comes from `listNotifications`.
 *
 * Data model (notifications table, convex/schema.ts):
 *   userId    — Kinde user ID of the recipient
 *   type      — event kind e.g. "damage_reported", "shipment_delivered"
 *   title     — short notification title
 *   message   — full notification message body
 *   caseId    — optional link to a case (for deep-link navigation)
 *   read      — whether the recipient has read this notification
 *   createdAt — epoch ms when the notification was created
 *
 * Indexes:
 *   by_user      — all notifications for a user (ordered by _creationTime)
 *   by_user_read — filter by user + read state (O(log n + |results|))
 *
 * Public queries:
 *   getUnreadCount   — reactive count of unread notifications for a user
 *   listNotifications — paginated notification list for a user (newest first)
 *
 * Public mutations:
 *   markAsRead       — mark a single notification as read
 *   markAllAsRead    — mark all unread notifications for a user as read
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Auth, UserIdentity } from "convex/server";

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 * Throws [AUTH_REQUIRED] for unauthenticated requests.
 */
async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token."
    );
  }
  return identity;
}

// ─── Notification type ────────────────────────────────────────────────────────

export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  caseId?: string;
  read: boolean;
  createdAt: number;
}

// ─── getUnreadCount ───────────────────────────────────────────────────────────

/**
 * Returns the count of unread notifications for the given user.
 *
 * Subscribed by the bell icon in the INVENTORY top bar.  Convex re-runs this
 * query whenever any notification row changes for `userId` — both new
 * notifications arriving and existing ones being marked as read.
 *
 * Index: by_user_read ["userId", "read"]
 *   Filters on both userId AND read=false in one O(log n + |results|) scan.
 *   Far more efficient than a by_user full-scan + in-memory filter.
 *
 * @param userId  Kinde user ID (the `sub` claim from the JWT).
 * @returns       Number of unread notifications. Returns 0 when none exist.
 *
 * @example
 * const count = useQuery(api.notifications.getUnreadCount, { userId });
 */
export const getUnreadCount = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<number> => {
    await requireAuth(ctx);

    if (!args.userId || args.userId.trim().length === 0) {
      return 0;
    }

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", args.userId).eq("read", false)
      )
      .collect();

    return unread.length;
  },
});

// ─── listNotifications ────────────────────────────────────────────────────────

/**
 * Returns the most recent notifications for the given user, newest first.
 *
 * Used by the notification bell dropdown to render the notification list.
 * Convex re-runs this query whenever any notification row changes for `userId`.
 *
 * @param userId  Kinde user ID.
 * @param limit   Maximum number of notifications to return (default: 20).
 * @returns       Array of NotificationRecord objects, newest first.
 *
 * @example
 * const notifications = useQuery(api.notifications.listNotifications, { userId });
 */
export const listNotifications = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<NotificationRecord[]> => {
    await requireAuth(ctx);

    if (!args.userId || args.userId.trim().length === 0) {
      return [];
    }

    const maxResults = args.limit ?? 20;

    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(maxResults);

    return rows.map((row) => ({
      id: row._id,
      userId: row.userId,
      type: row.type,
      title: row.title,
      message: row.message,
      caseId: row.caseId,
      read: row.read,
      createdAt: row.createdAt,
    }));
  },
});

// ─── markAsRead ───────────────────────────────────────────────────────────────

/**
 * Marks a single notification as read.
 *
 * Called when the user clicks a notification in the bell dropdown.
 * Validates that the notification belongs to the calling user before patching.
 *
 * @param notificationId  Convex document ID of the notification.
 * @param userId          Kinde user ID (to enforce ownership).
 *
 * @example
 * const markRead = useMutation(api.notifications.markAsRead);
 * await markRead({ notificationId, userId });
 */
export const markAsRead = mutation({
  args: {
    notificationId: v.id("notifications"),
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireAuth(ctx);

    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      // Already deleted or invalid ID — treat as no-op.
      return;
    }

    // Ownership check: only the recipient can mark their own notifications.
    if (notification.userId !== args.userId) {
      throw new Error(
        "[UNAUTHORIZED] You can only mark your own notifications as read."
      );
    }

    if (!notification.read) {
      await ctx.db.patch(args.notificationId, { read: true });
    }
  },
});

// ─── markAllAsRead ────────────────────────────────────────────────────────────

/**
 * Marks all unread notifications for the given user as read.
 *
 * Called when the user clicks "Mark all as read" in the bell dropdown.
 * Uses the by_user_read index to efficiently find only unread rows.
 *
 * @param userId  Kinde user ID.
 * @returns       Number of notifications marked as read.
 *
 * @example
 * const markAll = useMutation(api.notifications.markAllAsRead);
 * const count = await markAll({ userId });
 */
export const markAllAsRead = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<number> => {
    await requireAuth(ctx);

    if (!args.userId || args.userId.trim().length === 0) {
      return 0;
    }

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", args.userId).eq("read", false)
      )
      .collect();

    await Promise.all(
      unread.map((row) => ctx.db.patch(row._id, { read: true }))
    );

    return unread.length;
  },
});
