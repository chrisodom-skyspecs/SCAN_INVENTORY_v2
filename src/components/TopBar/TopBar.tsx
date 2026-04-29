/**
 * TopBar — 52px fixed top bar for the INVENTORY dashboard (layout and styling)
 *
 * Provides the structural chrome for the INVENTORY top bar:
 *
 *   ┌─────────────────────────────────────────────────────────┐  52px
 *   │ [logo + wordmark]   [  center slot  ]   [● 🔔 avatar]  │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Three regions:
 *   Left:   SkySpecs INVENTORY logomark + wordmark + product badge
 *   Center: Slot for additional content (e.g. search — added later)
 *   Right:  Live WebSocket indicator · Notification bell · User avatar
 *
 * Design:
 *   - Height driven by --shell-topbar-height (52px / 3.25rem) from §6 of base.css
 *   - Design tokens only — no hex literals
 *   - Inter Tight for UI text, IBM Plex Mono for the product badge
 *   - WCAG AA contrast in both light and dark themes
 *   - Reduced motion: pulse animations are suppressed by ConnectionIndicator
 *
 * This component is layout and styling only:
 *   - The avatar is a presentational element (not a button / no dropdown)
 *   - No search input, no keyboard shortcuts, no click handlers at this level
 *   - ConnectionIndicator and NotificationBell manage their own internal state
 *
 * Interactivity (avatar dropdown, search, keyboard shortcuts) is added in
 * subsequent acceptance criteria.
 *
 * Accessibility:
 *   - Rendered as <header role="banner"> for landmark navigation
 *   - The logo area has aria-label="SkySpecs INVENTORY"
 *   - The product badge has aria-hidden="true" (announced via parent aria-label)
 *   - The avatar has role="img" and aria-label for screen reader context
 *   - The right controls area has role="group" and aria-label
 */

"use client";

import { type ReactNode } from "react";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { NotificationBell } from "./NotificationBell";
import styles from "./TopBar.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TopBarProps {
  /**
   * Content rendered in the center slot (e.g. global search input).
   * Optional — the region collapses gracefully when empty.
   */
  center?: ReactNode;

  /**
   * User's initials to display in the avatar circle.
   * Should be 1–2 characters (e.g. "JD" for Jane Doe).
   * Defaults to "?" when not provided.
   */
  initials?: string;

  /**
   * Kinde user ID for the notification bell subscription.
   * Pass null or undefined when the user is not yet authenticated.
   * The bell renders in a "no-op" state when userId is absent.
   */
  userId?: string | null;

  /**
   * Additional CSS class names to apply to the outermost element.
   */
  className?: string;
}

// ─── Logo mark ────────────────────────────────────────────────────────────────

/**
 * SkySpecsLogoMark — geometric diamond / shield shape rendered as inline SVG.
 * Purely decorative; aria-hidden keeps it out of the accessibility tree.
 * Uses currentColor so CSS (var(--surface-brand)) controls the fill.
 */
function SkySpecsLogoMark() {
  return (
    <svg
      className={styles.logoMark}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Outer diamond shape */}
      <path
        d="M14 2L24 10L14 26L4 10L14 2Z"
        fill="currentColor"
        className={styles.logoMarkShape}
      />
      {/* Inner highlight chevron */}
      <path
        d="M14 7L20 12L14 21L8 12L14 7Z"
        fill="var(--ink-on-brand)"
        opacity="0.2"
      />
      {/* Center dot */}
      <circle cx="14" cy="13" r="2.5" fill="var(--ink-on-brand)" opacity="0.9" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * TopBar — 52px INVENTORY dashboard top bar.
 *
 * Structural / presentational component that composes the three regions of the
 * top bar chrome.  Interactive features (avatar dropdown, search, keyboard
 * shortcuts) are wired up separately via InventoryNavbar or a future integration.
 *
 * @example
 * // Minimal — layout and styling only
 * <TopBar />
 *
 * // With user context
 * <TopBar initials="JD" userId={user.id} />
 *
 * // With center slot (e.g. search input added later)
 * <TopBar initials="JD" userId={user.id} center={<SearchInput />} />
 */
export function TopBar({
  center,
  initials = "?",
  userId,
  className,
}: TopBarProps) {
  return (
    <header
      className={[styles.topBar, className].filter(Boolean).join(" ")}
      role="banner"
      aria-label="SkySpecs INVENTORY"
    >
      {/* ── Left: logomark + wordmark + product badge ──────────────── */}
      <div className={styles.logoArea} aria-label="SkySpecs INVENTORY">
        {/* Geometric diamond logomark */}
        <SkySpecsLogoMark />

        {/* Wordmark: "Sky" in brand color, "Specs" in primary ink */}
        <div className={styles.wordmark} aria-hidden="true">
          <span className={styles.wordmarkSky}>Sky</span>
          <span className={styles.wordmarkSpecs}>Specs</span>
        </div>

        {/* Product badge: "INVENTORY" in IBM Plex Mono */}
        <span
          className={styles.productBadge}
          aria-hidden="true" /* announced via parent aria-label */
        >
          INVENTORY
        </span>
      </div>

      {/* ── Center: slot for additional content (e.g. search) ──────── */}
      {/*
        This region uses flex: 1 to fill available horizontal space,
        keeping the right controls anchored to the far right edge.
        Pass `center` prop to inject content here (e.g. a SearchInput).
        Empty when not provided — the flex layout handles it gracefully.
      */}
      <div className={styles.centerSlot} aria-hidden={!center}>
        {center}
      </div>

      {/* ── Right: live indicator + notification bell + avatar ──────── */}
      <div
        className={styles.rightArea}
        role="group"
        aria-label="User controls"
      >
        {/*
          ConnectionIndicator — 8px pulsing dot reflecting Convex WebSocket state.
          Green = connected, amber = connecting/reconnecting, red = disconnected.
          Manages its own Convex subscription internally via useConvexStatus().
        */}
        <ConnectionIndicator className={styles.liveIndicator} />

        {/*
          NotificationBell — bell icon with unread-count badge.
          Fetches notification count via Convex subscription when userId is present.
          The bell button and dropdown are self-contained in NotificationBell.
        */}
        <NotificationBell userId={userId} className={styles.notificationBell} />

        {/*
          Avatar — presentational only (no dropdown / no button) at this stage.
          Shows the user's initials in a circular badge.
          role="img" + aria-label announces it as a visual identity element.

          Note: The avatar becomes an interactive trigger with dropdown in the
          InventoryNavbar component which adds full interactivity on top of this
          structural TopBar layout.
        */}
        <div
          className={styles.avatar}
          role="img"
          aria-label={`User avatar — ${initials}`}
          title={`Signed in (${initials})`}
        >
          <span className={styles.avatarInitials} aria-hidden="true">
            {initials}
          </span>
        </div>
      </div>
    </header>
  );
}

export default TopBar;
