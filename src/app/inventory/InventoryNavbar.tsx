/**
 * InventoryNavbar — INVENTORY dashboard top navigation bar (client component)
 *
 * Displays:
 *   • Left:   SkySpecs INVENTORY logomark + wordmark
 *   • Center: Global search input with cmd-K / Ctrl+K keyboard shortcut
 *   • Right:  Live WebSocket dot + notification bell + user avatar dropdown
 *
 * Auth state is read via useKindeBrowserClient() (the current, non-deprecated
 * Kinde hook for App Router client components).  The user object is available
 * immediately from the session cookie hydrated by KindeProvider.
 *
 * Live WebSocket indicator:
 *   A small pulsing dot (ConnectionIndicator) reflects the Convex WebSocket
 *   connection state.  Green = connected, amber = connecting/reconnecting,
 *   red = disconnected.  Tied to useConvexConnectionState() from convex/react.
 *
 * Notification bell:
 *   A bell icon (NotificationBell) with an unread-count badge reflects the
 *   number of unread in-app notifications for the current user.  Clicking it
 *   opens a dropdown with recent notifications and a "Mark all read" action.
 *   The count updates in real time via a Convex subscription.
 *
 * Global search:
 *   A centered search input is rendered between the wordmark and the user
 *   avatar.  Pressing ⌘K (macOS) or Ctrl+K (Windows/Linux) from anywhere in
 *   the document focuses the input and selects any existing text so the user
 *   can start typing immediately.  A visible keyboard hint badge to the right
 *   of the placeholder text communicates the shortcut.
 *
 * Logout:
 *   The LogoutLink component from @kinde-oss/kinde-auth-nextjs renders an <a>
 *   tag pointing to /api/auth/logout.  The Kinde route handler clears the
 *   session cookies and redirects to KINDE_POST_LOGOUT_REDIRECT_URL (/) from
 *   .env.local, which lands the user on the public root page / login screen.
 *
 * Dropdown placeholder:
 *   The avatar button opens a dropdown panel with user identity info and a
 *   logout action.  Additional menu items (profile, settings) are placeholders
 *   for future work; only logout is functional now.
 *
 * Design:
 *   - Uses design tokens only (CSS custom properties) — no hex literals.
 *   - Inter Tight for UI text, IBM Plex Mono for the product badge and kbd hints.
 *   - WCAG AA contrast in both light and dark themes.
 *   - Height driven by --inv-navbar-height / --shell-topbar-height CSS variable.
 *   - Focus trap: Escape closes the dropdown; click-outside closes it.
 *   - Reduced motion: transitions removed when prefers-reduced-motion is active.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";
import { LogoutLink } from "@kinde-oss/kinde-auth-nextjs/components";
import { ConnectionIndicator } from "@/components/TopBar/ConnectionIndicator";
import { NotificationBell } from "@/components/TopBar/NotificationBell";
import { DensityToggle } from "@/components/DensityToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalSearchModal } from "@/components/GlobalSearchModal";
import { trackEvent } from "@/lib/telemetry.lib";
import { TelemetryEventName } from "@/types/telemetry.types";
import styles from "./InventoryNavbar.module.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detect whether the current platform is macOS.
 *
 * Checks `navigator.userAgentData.platform` first (Chromium-based browsers),
 * then falls back to the deprecated-but-universal `navigator.platform`.
 * Returns `false` when running server-side (navigator is undefined).
 */
function detectIsMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // userAgentData is available in Chromium browsers (Chrome ≥ 90, Edge ≥ 90)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uaData = (navigator as any).userAgentData;
  if (uaData?.platform) {
    return (uaData.platform as string).toLowerCase().includes("mac");
  }
  // Fallback: navigator.platform (deprecated but universally supported)
  return navigator.platform.toLowerCase().includes("mac");
}

/**
 * Derive up to 2 initials from the user's name.
 * Falls back to the first character of email if no name is set.
 */
function getInitials(
  givenName?: string | null,
  familyName?: string | null,
  email?: string | null,
): string {
  const first = givenName?.trim() ?? "";
  const last = familyName?.trim() ?? "";

  if (first && last) {
    return `${first[0]}${last[0]}`.toUpperCase();
  }
  if (first) {
    return first[0].toUpperCase();
  }
  if (email) {
    return email[0].toUpperCase();
  }
  return "?";
}

/**
 * Format the display name shown next to the avatar.
 * Uses given name + family name initial, or email as fallback.
 */
function getDisplayName(
  givenName?: string | null,
  familyName?: string | null,
  email?: string | null,
): string {
  const first = givenName?.trim() ?? "";
  const last = familyName?.trim() ?? "";

  if (first && last) {
    return `${first} ${last[0]}.`;
  }
  if (first) {
    return first;
  }
  if (email) {
    // Show only the local-part of the email address to keep it compact.
    return email.split("@")[0];
  }
  return "User";
}

// ─── Search icon ──────────────────────────────────────────────────────────────

/**
 * Magnifying glass icon — rendered inside the search input wrapper.
 * Purely decorative; aria-hidden keeps it out of the accessibility tree.
 */
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Logo mark ────────────────────────────────────────────────────────────────

/**
 * SkySpecs logomark — a stylized diamond / shield shape rendered as inline SVG.
 * Purely decorative; aria-hidden keeps it out of the accessibility tree.
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
      {/* Outer diamond */}
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

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * InventoryNavbarProps — optional mobile nav toggle integration.
 *
 * When the parent (InventoryShell) manages mobile nav state it passes these
 * two props down so the navbar can render a hamburger/close button and
 * communicate the correct aria-expanded state.
 *
 * Both props are optional so that existing tests that render InventoryNavbar
 * in isolation (without InventoryShell) continue to work without modification.
 */
export interface InventoryNavbarProps {
  /**
   * Called when the mobile menu toggle button is clicked.
   * When absent, the toggle button is not rendered.
   */
  onMenuToggle?: () => void;
  /**
   * Whether the mobile nav drawer is currently open.
   * Drives aria-expanded on the toggle button and the icon variant shown.
   * Defaults to false when absent.
   */
  mobileNavOpen?: boolean;
}

// ─── Hamburger / close icons ──────────────────────────────────────────────────

/**
 * MenuIcon — three-line hamburger icon for the mobile nav toggle (closed state).
 */
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5A.75.75 0 0 1 2.75 9h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 9.75Zm0 5A.75.75 0 0 1 2.75 14h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 14.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * XIcon — close / X icon for the mobile nav toggle (open state).
 */
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Top navigation bar for the INVENTORY dashboard.
 *
 * Rendered server-side in the inventory layout (RSC) but this specific
 * component is a Client Component to consume the Kinde browser client hook
 * and manage the avatar dropdown state.
 */
export function InventoryNavbar({
  onMenuToggle,
  mobileNavOpen = false,
}: InventoryNavbarProps = {}) {
  const { user } = useKindeBrowserClient();

  const initials = getInitials(user?.given_name, user?.family_name, user?.email);
  const displayName = getDisplayName(user?.given_name, user?.family_name, user?.email);
  const email = user?.email ?? null;

  // ── Search modal state ────────────────────────────────────────────────────
  /**
   * isSearchModalOpen — controls visibility of the GlobalSearchModal overlay.
   *
   * Opening triggers:
   *   • cmd-K / Ctrl+K keyboard shortcut (document-level listener below)
   *   • Clicking the search trigger button in the navbar center slot
   *
   * Closing triggers (delegated to GlobalSearchModal):
   *   • Escape key
   *   • Backdrop click
   *   • Close button inside the modal
   */
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const isSearchModalOpenRef = useRef(false);

  /**
   * isMac — controls whether we display ⌘K or Ctrl+K in the kbd hint.
   * Starts as false (safe SSR default) and is updated on the client after
   * the first paint to avoid hydration mismatches.
   */
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(detectIsMac());
  }, []);

  /**
   * Global cmd-K / Ctrl+K shortcut — opens the GlobalSearchModal.
   *
   * Uses a ref to read the current isSearchModalOpen state without a stale
   * closure (the useEffect has no deps, so the closure captures the initial
   * false value without the ref).
   *
   * If the modal is already open, pressing cmd-K closes it.
   */
  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      const isModifierActive = event.metaKey || event.ctrlKey;
      if (isModifierActive && event.key === "k") {
        event.preventDefault();
        // Toggle modal using the ref to avoid stale closure
        const next = !isSearchModalOpenRef.current;
        isSearchModalOpenRef.current = next;
        setIsSearchModalOpen(next);
      }
    }

    document.addEventListener("keydown", handleSearchShortcut);
    return () => {
      document.removeEventListener("keydown", handleSearchShortcut);
    };
  }, []);

  /**
   * openSearchModal — called when the trigger button is clicked.
   * Keeps the ref in sync so the keyboard toggle remains accurate.
   */
  const openSearchModal = useCallback(() => {
    isSearchModalOpenRef.current = true;
    setIsSearchModalOpen(true);
  }, []);

  /**
   * closeSearchModal — called by GlobalSearchModal via its onClose prop.
   * Keeps the ref in sync so subsequent cmd-K presses open (not close) the modal.
   */
  const closeSearchModal = useCallback(() => {
    isSearchModalOpenRef.current = false;
    setIsSearchModalOpen(false);
  }, []);

  // ── Search submit handler (telemetry only) ────────────────────────────────
  //
  // Fired by GlobalSearchModal when the user presses Enter.
  // The query value is not logged (length only) to avoid capturing case IDs
  // or operator names in raw telemetry payloads.
  const handleSearchSubmit = useCallback((query: string) => {
    trackEvent({
      eventCategory: "user_action",
      eventName: TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED,
      app: "inventory",
      queryLength: query.trim().length,
      submitMethod: "form_submit",
    });
  }, []);


  // ── Dropdown state ────────────────────────────────────────────────────────
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
  }, []);

  const toggleDropdown = useCallback(() => {
    setDropdownOpen((prev) => !prev);
  }, []);

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    if (!dropdownOpen) return;

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
  }, [dropdownOpen, closeDropdown]);

  return (
    <nav
      className={styles.navbar}
      role="navigation"
      aria-label="INVENTORY main navigation"
    >
      {/* ── Mobile menu toggle — visible only on ≤ 768px ─────────────
            Renders a hamburger (closed) or X (open) icon button.
            aria-expanded reflects the current drawer state for AT.
            aria-controls points to the nav landmark in AppShell.
            Hidden at ≥ 769px via CSS (display:none in .menuToggle default).
            Not rendered at all when onMenuToggle is absent (e.g. in tests
            that render InventoryNavbar without the InventoryShell wrapper).
          ─────────────────────────────────────────────────────────── */}
      {onMenuToggle && (
        <button
          type="button"
          className={styles.menuToggle}
          onClick={onMenuToggle}
          aria-expanded={mobileNavOpen}
          aria-controls="inventory-side-nav"
          aria-label={
            mobileNavOpen
              ? "Close navigation menu"
              : "Open navigation menu"
          }
        >
          {mobileNavOpen ? (
            <XIcon className={styles.menuToggleIcon} />
          ) : (
            <MenuIcon className={styles.menuToggleIcon} />
          )}
        </button>
      )}

      {/* ── Left: logomark + wordmark ───────────────────────────────── */}
      <div className={styles.wordmarkBlock} aria-label="SkySpecs INVENTORY">
        {/* Geometric logomark */}
        <SkySpecsLogoMark />

        {/* Text wordmark: "Sky" in brand color + "Specs" in primary ink */}
        <div className={styles.wordmarkLogo}>
          <span className={styles.wordmarkSky}>Sky</span>
          <span className={styles.wordmarkSpecs}>Specs</span>
        </div>

        {/* Product badge: "INVENTORY" in IBM Plex Mono */}
        <span className={styles.wordmarkProduct} aria-label="INVENTORY">
          INVENTORY
        </span>
      </div>

      {/* ── Center: global search trigger button ──────────────────── */}
      {/*
        Clicking this affordance (or pressing cmd-K / Ctrl+K from anywhere)
        opens the GlobalSearchModal overlay.

        The button looks like a search input to reinforce affordance.
        It is intentionally not a real <input> — the actual input lives
        inside the GlobalSearchModal overlay so focus management is clean.

        aria-keyshortcuts communicates the keyboard shortcut to AT.
        aria-haspopup="dialog" signals that activation opens a dialog.
      */}
      <div className={styles.searchCenter}>
        <button
          type="button"
          className={styles.searchInputWrapper}
          onClick={openSearchModal}
          aria-label="Search cases"
          aria-haspopup="dialog"
          aria-expanded={isSearchModalOpen}
          aria-keyshortcuts={isMac ? "Meta+k" : "Control+k"}
          data-open={isSearchModalOpen ? "true" : "false"}
        >
          {/* Magnifying glass — decorative, left of placeholder text */}
          <SearchIcon className={styles.searchIcon} />

          <span className={styles.searchPlaceholder} aria-hidden="true">
            Search cases…
          </span>

          {/*
           * Keyboard hint — shown to the right of the placeholder.
           * aria-hidden: the shortcut is already discoverable via keyboard;
           * screen readers don't need to announce it on every render.
           */}
          <span className={styles.searchKbdHint} aria-hidden="true">
            {isMac ? (
              <kbd className={styles.kbdKey}>⌘K</kbd>
            ) : (
              <>
                <kbd className={styles.kbdKey}>Ctrl</kbd>
                <span className={styles.kbdSep}>+</span>
                <kbd className={styles.kbdKey}>K</kbd>
              </>
            )}
          </span>
        </button>
      </div>

      {/* ── GlobalSearchModal overlay (portal, rendered in document.body) ── */}
      <GlobalSearchModal
        isOpen={isSearchModalOpen}
        onClose={closeSearchModal}
        onSubmit={handleSearchSubmit}
      />

      {/* ── Right: density toggle + live indicator + notification bell + user avatar ── */}
      <div className={styles.userArea}>
        {/*
         * Theme toggle — light / dark mode switcher.
         * Adds/removes the `theme-dark` class on <html> and persists to
         * localStorage["theme_preference"].  All design token overrides in
         * base.css §3 (surfaces, inks, borders, elevation) and §5h (map tokens)
         * resolve automatically once the class is applied — no component-level
         * changes are required.
         */}
        <ThemeToggle className={styles.themeToggle} />

        {/*
         * Density toggle — comfy / compact layout switcher.
         * Sets data-density on <html> and persists to localStorage["inv_density"].
         * Consuming components reference §9 density tokens (--density-*) from
         * base.css for all spacing, sizing, and typography adjustments.
         */}
        <DensityToggle className={styles.densityToggle} />

        {/* Live WebSocket connection indicator — pulsing dot tied to Convex state */}
        <ConnectionIndicator className={styles.liveIndicator} />

        {/* Notification bell — unread badge count from Convex subscription */}
        <NotificationBell userId={user?.id} className={styles.notificationBell} />
        {/*
         * Avatar trigger button
         * Clicking opens the dropdown with user info + logout.
         * aria-expanded reflects the open state for screen readers.
         * aria-haspopup="menu" signals that this button opens a menu.
         */}
        <button
          ref={triggerRef}
          type="button"
          className={styles.avatarTrigger}
          onClick={toggleDropdown}
          aria-expanded={dropdownOpen}
          aria-haspopup="menu"
          aria-label={`User menu for ${displayName}`}
        >
          {/* Avatar circle — shows initials */}
          <span
            className={styles.userAvatar}
            role="img"
            aria-hidden="true"
            title={displayName}
          >
            <span className={styles.userAvatarInitials}>{initials}</span>
          </span>

          {/* Display name — hidden on narrow viewports */}
          <span className={styles.userName} aria-hidden="true">
            {displayName}
          </span>

          {/* Chevron — rotates 180° when dropdown is open */}
          <svg
            className={styles.chevron}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            data-open={dropdownOpen ? "true" : "false"}
          >
            <path
              fillRule="evenodd"
              d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* ── Dropdown menu ─────────────────────────────────────────── */}
        {dropdownOpen && (
          <div
            ref={dropdownRef}
            className={styles.dropdown}
            role="menu"
            aria-label="User menu"
          >
            {/* User identity header */}
            <div className={styles.dropdownHeader}>
              {/* Large avatar in dropdown header */}
              <span
                className={styles.dropdownAvatar}
                role="img"
                aria-hidden="true"
              >
                <span className={styles.dropdownAvatarInitials}>{initials}</span>
              </span>

              <div className={styles.dropdownIdentity}>
                <span className={styles.dropdownName}>{displayName}</span>
                {email && (
                  <span className={styles.dropdownEmail}>{email}</span>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className={styles.dropdownDivider} role="separator" aria-hidden="true" />

            {/*
             * Placeholder menu items — these will be wired to real functionality
             * in subsequent acceptance criteria.  They are rendered as <button>s
             * with role="menuitem" so screen readers announce them correctly.
             */}
            <button
              type="button"
              className={styles.dropdownItem}
              role="menuitem"
              disabled
              aria-disabled="true"
            >
              <svg
                className={styles.dropdownItemIcon}
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M8 1.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM.5 8a7.5 7.5 0 1 1 15 0A7.5 7.5 0 0 1 .5 8Z"
                  clipRule="evenodd"
                />
                <path d="M8 5a1 1 0 0 1 1 1v1.5H10a.5.5 0 0 1 0 1H7a.5.5 0 0 1 0-1h1V6a1 1 0 0 1-1-1Z" />
              </svg>
              Profile
              <span className={styles.dropdownItemBadge}>Soon</span>
            </button>

            <button
              type="button"
              className={styles.dropdownItem}
              role="menuitem"
              disabled
              aria-disabled="true"
            >
              <svg
                className={styles.dropdownItemIcon}
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M6.955 1.045a.75.75 0 0 1 2.09 0l.175.28a.75.75 0 0 0 1.025.268l.302-.15a.75.75 0 0 1 1.03.317l.544 1.087a.75.75 0 0 1-.317 1.03l-.302.15a.75.75 0 0 0-.39.913l.093.329A.75.75 0 0 1 10.5 6h-.344a.75.75 0 0 0-.721.543L9.22 7a.75.75 0 0 0 .722.543H10.5a.75.75 0 0 1 .705.983l-.093.33a.75.75 0 0 0 .39.912l.302.15a.75.75 0 0 1 .317 1.03l-.544 1.087a.75.75 0 0 1-1.03.317l-.302-.15a.75.75 0 0 0-1.025.268l-.175.28a.75.75 0 0 1-2.09 0l-.175-.28a.75.75 0 0 0-1.025-.268l-.302.15a.75.75 0 0 1-1.03-.317L3.3 10.313a.75.75 0 0 1 .317-1.03l.302-.15a.75.75 0 0 0 .39-.912l-.093-.33A.75.75 0 0 1 5.5 7h.344a.75.75 0 0 0 .721-.543L6.78 6a.75.75 0 0 0-.721-.543H5.5a.75.75 0 0 1-.705-.983l.093-.33a.75.75 0 0 0-.39-.912l-.302-.15a.75.75 0 0 1-.317-1.03l.544-1.087a.75.75 0 0 1 1.03-.317l.302.15a.75.75 0 0 0 1.025-.268l.175-.28ZM8 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                  clipRule="evenodd"
                />
              </svg>
              Settings
              <span className={styles.dropdownItemBadge}>Soon</span>
            </button>

            {/* Divider before destructive action */}
            <div className={styles.dropdownDivider} role="separator" aria-hidden="true" />

            {/* Logout — functional (via Kinde LogoutLink) */}
            <LogoutLink
              className={styles.dropdownLogout}
              role="menuitem"
              aria-label="Log out of SkySpecs INVENTORY"
            >
              <svg
                className={styles.dropdownItemIcon}
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  fillRule="evenodd"
                  d="M2 3.5A1.5 1.5 0 0 1 3.5 2h5A1.5 1.5 0 0 1 10 3.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 1 1 0v1A1.5 1.5 0 0 1 8.5 14h-5A1.5 1.5 0 0 1 2 12.5v-9Z"
                  clipRule="evenodd"
                />
                <path
                  fillRule="evenodd"
                  d="M15.354 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L13.293 7.5H6a.5.5 0 0 0 0 1h7.293l-1.647 1.646a.5.5 0 0 0 .708.708l3-3Z"
                  clipRule="evenodd"
                />
              </svg>
              Log out
            </LogoutLink>
          </div>
        )}
      </div>
    </nav>
  );
}

export default InventoryNavbar;
