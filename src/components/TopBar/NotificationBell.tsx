/**
 * NotificationBell — In-app notification bell for the INVENTORY top bar
 *
 * Displays a bell icon with an unread-count badge.  When clicked, opens a
 * dropdown showing recent notifications with the ability to mark them as read.
 *
 * Features:
 *   • Real-time unread count badge (Convex subscription via useNotifications)
 *   • Badge shows count capped at "9+" to avoid overflow on narrow badges
 *   • Badge hidden when unread count is 0
 *   • Dropdown with recent notifications (newest first)
 *   • "Mark all as read" action
 *   • Per-notification "mark as read" on click
 *   • Keyboard accessible: Escape closes the dropdown, Tab moves focus through it
 *   • Click-outside closes the dropdown
 *   • aria-expanded, aria-haspopup, aria-label for screen reader support
 *
 * Auth:
 *   Receives userId from the parent (InventoryNavbar) which reads it from
 *   useKindeBrowserClient().  The hook skips Convex queries when userId is null
 *   (unauthenticated), preventing spurious network requests before auth resolves.
 *
 * Design:
 *   • Design tokens only — no hex literals
 *   • Inter Tight for notification text, IBM Plex Mono for timestamps
 *   • WCAG AA contrast in both light and dark themes
 *   • Reduced motion: dropdown transition removed
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNotifications } from "@/hooks/use-notifications";
import type { Notification } from "@/hooks/use-notifications";
import styles from "./NotificationBell.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface NotificationBellProps {
  /**
   * Kinde user ID for fetching this user's notifications.
   * Pass null/undefined when the user is not yet authenticated.
   */
  userId: string | null | undefined;
  /** Additional CSS class names to apply to the wrapper element. */
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an epoch-ms timestamp as a relative time string.
 * Returns "just now" for < 60s, "Xm ago" for < 60m, "Xh ago" for < 24h,
 * and a short date string for older notifications.
 */
function formatRelativeTime(epochMs: number): string {
  const nowMs = Date.now();
  const diffMs = nowMs - epochMs;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return new Date(epochMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Format the badge count: shows the raw number up to 9, then "9+" for larger counts.
 */
function formatBadgeCount(count: number): string {
  if (count <= 0) return "";
  if (count > 9) return "9+";
  return String(count);
}

// ─── Bell icon ────────────────────────────────────────────────────────────────

/**
 * Bell SVG icon — decorative, aria-hidden.
 * Uses currentColor so CSS controls the fill.
 */
function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* Bell body */}
      <path
        fillRule="evenodd"
        d="M10 2a6 6 0 0 0-6 6v3.586l-.707.707A1 1 0 0 0 4 14h12a1 1 0 0 0 .707-1.707L16 11.586V8a6 6 0 0 0-6-6ZM10 18a3 3 0 0 1-2.83-2h5.66A3 3 0 0 1 10 18Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyNotifications() {
  return (
    <div className={styles.emptyState}>
      <BellIcon className={styles.emptyIcon} />
      <p className={styles.emptyTitle}>You&rsquo;re all caught up</p>
      <p className={styles.emptyBody}>
        No new notifications — check back after field operations.
      </p>
    </div>
  );
}

// ─── Single notification row ──────────────────────────────────────────────────

interface NotificationRowProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
}

function NotificationRow({ notification, onMarkAsRead }: NotificationRowProps) {
  const handleClick = useCallback(() => {
    if (!notification.read) {
      onMarkAsRead(notification.id);
    }
    // Future: navigate to the linked case via notification.caseId
  }, [notification, onMarkAsRead]);

  return (
    <button
      type="button"
      className={styles.notificationRow}
      data-read={notification.read ? "true" : "false"}
      onClick={handleClick}
      aria-label={
        notification.read
          ? notification.title
          : `Unread: ${notification.title}`
      }
    >
      {/* Unread indicator dot */}
      {!notification.read && (
        <span className={styles.unreadDot} aria-hidden="true" />
      )}

      <div className={styles.notificationContent}>
        <span className={styles.notificationTitle}>{notification.title}</span>
        <span className={styles.notificationMessage}>
          {notification.message}
        </span>
        <span className={styles.notificationTime}>
          {formatRelativeTime(notification.createdAt)}
        </span>
      </div>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * In-app notification bell for the INVENTORY top bar.
 *
 * Subscribes to the user's unread notification count via useNotifications().
 * Shows a badge when unread count > 0.  Opens a dropdown on click.
 */
export function NotificationBell({ userId, className }: NotificationBellProps) {
  // ── Notifications subscription ────────────────────────────────────────────
  const { unreadCount, notifications, markAsRead, markAllAsRead } =
    useNotifications(userId);

  // ── Dropdown state ────────────────────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleDropdown = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Close on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        closeDropdown();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDropdown();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, closeDropdown]);

  // ── Mark as read handlers ─────────────────────────────────────────────────

  const handleMarkAsRead = useCallback(
    (id: string) => {
      markAsRead(id);
    },
    [markAsRead],
  );

  const handleMarkAllAsRead = useCallback(() => {
    markAllAsRead();
  }, [markAllAsRead]);

  // ── Badge display ─────────────────────────────────────────────────────────

  const badgeText = formatBadgeCount(unreadCount);
  const hasBadge = unreadCount > 0;

  return (
    <div
      className={[styles.wrapper, className].filter(Boolean).join(" ")}
      aria-label="Notifications"
    >
      {/* ── Bell trigger button ─────────────────────────────────────── */}
      <button
        ref={triggerRef}
        type="button"
        className={styles.bellButton}
        onClick={toggleDropdown}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={
          hasBadge
            ? `Notifications — ${unreadCount} unread`
            : "Notifications — no unread"
        }
        title={
          hasBadge
            ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
            : "No unread notifications"
        }
        data-has-unread={hasBadge ? "true" : "false"}
      >
        {/* Bell icon */}
        <BellIcon className={styles.bellIcon} />

        {/* Unread count badge — only shown when unread > 0 */}
        {hasBadge && (
          <span
            className={styles.badge}
            aria-hidden="true" /* count announced in aria-label above */
            data-overflow={unreadCount > 9 ? "true" : "false"}
          >
            {badgeText}
          </span>
        )}
      </button>

      {/* ── Notification dropdown ───────────────────────────────────── */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          role="dialog"
          aria-label="Notifications"
          aria-modal="false"
        >
          {/* Dropdown header */}
          <div className={styles.dropdownHeader}>
            <span className={styles.dropdownTitle}>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className={styles.markAllButton}
                onClick={handleMarkAllAsRead}
                aria-label={`Mark all ${unreadCount} notifications as read`}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Divider */}
          <div
            className={styles.dropdownDivider}
            role="separator"
            aria-hidden="true"
          />

          {/* Notification list or empty state */}
          <div
            className={styles.notificationList}
            role="list"
            aria-label="Recent notifications"
          >
            {notifications.length === 0 ? (
              <EmptyNotifications />
            ) : (
              notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onMarkAsRead={handleMarkAsRead}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
