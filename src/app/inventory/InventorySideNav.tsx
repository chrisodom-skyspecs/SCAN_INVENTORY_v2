/**
 * InventorySideNav — INVENTORY dashboard side navigation panel
 *
 * Renders the primary navigation links for the INVENTORY dashboard.
 * Each item routes to a map mode via the `?view=` search parameter.
 *
 * Nav item anatomy:
 *   • icon   — 16×16 SVG, always visible (centred in the 52px collapsed strip)
 *   • label  — text label, visible at ≥ 1025px; hidden at 769–1024px; visible
 *               in the mobile overlay drawer
 *   • tooltip — shown on hover in collapsed mode (CSS only via title attribute)
 *
 * Active state:
 *   An item is "active" when the current URL's `view` search param matches
 *   the item's `mapView` key.  When no `view` param is present the default
 *   is M1 (Fleet Overview), so that item is highlighted on first load.
 *
 * Responsive behaviour (mirrors AppShell.module.css breakpoints):
 *   ≥ 1025px   Full labels shown
 *   769–1024px Labels hidden — icon-only strip with title attribute tooltips
 *   ≤ 768px    Full labels shown (overlay drawer expands to full width)
 *
 * Feature flags:
 *   Mission Control (M5) is hidden when FF_MAP_MISSION is disabled.
 *
 * Accessibility:
 *   • `<nav>` landmark provided by AppShell's .sideNav container.
 *   • Each link has `aria-current="page"` on the active item.
 *   • Icon SVGs are `aria-hidden`; label is the accessible name.
 *   • `title` attribute on collapsed links provides tooltip + accessible
 *     label fallback when label text is visually hidden.
 *
 * Design tokens:
 *   --surface-sidebar-item   transparent background (default)
 *   --surface-sidebar-hover  hover fill
 *   --surface-sidebar-active active/selected fill
 *   --ink-primary            default link text color
 *   --ink-brand              active item text + icon color
 *   All from §2/§3 of src/styles/tokens/base.css
 */

"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ComponentType } from "react";
import { trackEvent } from "@/lib/telemetry.lib";
import { TelemetryEventName } from "@/types/telemetry.types";
import styles from "./InventorySideNav.module.css";

// ─── Feature flags ─────────────────────────────────────────────────────────────

/**
 * FF_MAP_MISSION — gates the M5 Mission Control nav item.
 * Set NEXT_PUBLIC_FF_MAP_MISSION=1 in your environment to show it.
 */
const FF_MAP_MISSION =
  process.env.NEXT_PUBLIC_FF_MAP_MISSION === "1" ||
  process.env.NEXT_PUBLIC_FF_MAP_MISSION === "true";

// ─── Icon components ──────────────────────────────────────────────────────────

interface IconProps {
  className?: string;
}

/**
 * M1 Fleet Overview icon — a grid of map pins representing a fleet scatter.
 */
function FleetOverviewIcon({ className }: IconProps) {
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
        d="M8 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM7 4a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z"
        clipRule="evenodd"
      />
      <path d="M8 7.5c-2.5 0-4.5 1-4.5 2.25V11h9v-1.25C12.5 8.5 10.5 7.5 8 7.5Z" />
      <circle cx="3" cy="3.5" r="1.5" />
      <circle cx="13" cy="3.5" r="1.5" />
      <circle cx="3" cy="12.5" r="1.5" />
      <circle cx="13" cy="12.5" r="1.5" />
    </svg>
  );
}

/**
 * M2 Site Detail icon — map with a location pin marker.
 */
function SiteDetailIcon({ className }: IconProps) {
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
        d="M8 1a4 4 0 0 0-4 4c0 2.5 4 9 4 9s4-6.5 4-9a4 4 0 0 0-4-4Zm0 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * M3 Transit Tracker icon — truck / shipping vehicle outline.
 */
function TransitTrackerIcon({ className }: IconProps) {
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
        d="M1 3.5A1.5 1.5 0 0 1 2.5 2h7A1.5 1.5 0 0 1 11 3.5V5h1.379a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 1 15 7.622V10.5a1.5 1.5 0 0 1-1.5 1.5H13a2 2 0 1 1-4 0H7a2 2 0 1 1-4 0H2.5A1.5 1.5 0 0 1 1 10.5v-7Zm10 7a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm-7 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * M4 Deployment icon — a diamond/grid representing deployment sites.
 */
function DeploymentIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 1 L14 5 L14 11 L8 15 L2 11 L2 5 Z" />
      <path
        d="M8 4 L11 6.5 L11 9.5 L8 12 L5 9.5 L5 6.5 Z"
        fill="var(--surface-sidebar)"
        style={{ fill: "var(--surface-sidebar, white)" }}
      />
    </svg>
  );
}

/**
 * M5 Mission Control icon — crosshair / targeting reticle.
 */
function MissionControlIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="5.5" />
      <line x1="8" y1="1" x2="8" y2="4" />
      <line x1="8" y1="12" x2="8" y2="15" />
      <line x1="1" y1="8" x2="4" y2="8" />
      <line x1="12" y1="8" x2="15" y2="8" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ─── Section divider icon — used as visual separator in the nav ───────────────

/**
 * Cases icon — a stack of boxes/cases.
 */
function CasesIcon({ className }: IconProps) {
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
        d="M2.5 3A1.5 1.5 0 0 0 1 4.5v3A1.5 1.5 0 0 0 2.5 9h11A1.5 1.5 0 0 0 15 7.5v-3A1.5 1.5 0 0 0 13.5 3h-11ZM2 8v4.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V8H2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Shipments icon — outbound bundle / carrier box.
 */
function ShipmentsIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 4.25A1.75 1.75 0 0 1 3.75 2.5h5.5A1.75 1.75 0 0 1 11 4.25V5h1.05c.47 0 .913.22 1.197.596l1.45 1.92c.196.26.303.577.303.904v2.33A1.75 1.75 0 0 1 13.25 12.5h-.39a2 2 0 0 1-3.72 0H6.36a2 2 0 0 1-3.72 0H2.5A1.5 1.5 0 0 1 1 11V5.25c0-.552.448-1 1-1Zm1.75-.25a.25.25 0 0 0-.25.25V11h.14a2 2 0 0 1 3.72 0H9.25V4.25A.25.25 0 0 0 9 4H3.75ZM11 6.5V11h.14a2 2 0 0 1 2.36-1.358V8.42l-1.45-1.92H11ZM4.5 13a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Zm6.5-.5a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0Z" />
    </svg>
  );
}

/**
 * Add icon — quick action for a new outbound shipment.
 */
function AddIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 2.25a.75.75 0 0 1 .75.75v4.25H13a.75.75 0 0 1 0 1.5H8.75V13a.75.75 0 0 1-1.5 0V8.75H3a.75.75 0 0 1 0-1.5h4.25V3A.75.75 0 0 1 8 2.25Z" />
    </svg>
  );
}

/**
 * Reports icon — document with chart lines.
 */
function ReportsIcon({ className }: IconProps) {
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
        d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V5.828a1.5 1.5 0 0 0-.44-1.06L10.732 2.44A1.5 1.5 0 0 0 9.672 2H4ZM9.5 3.5V5A1.5 1.5 0 0 0 11 6.5h1.5L9.5 3.5ZM5 8.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 8.75Zm.75 2.25a.75.75 0 0 0 0 1.5H8a.75.75 0 0 0 0-1.5H5.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Settings / Admin icon — cog/gear wheel.
 */
function AdminIcon({ className }: IconProps) {
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
        d="M6.955 1.045a.75.75 0 0 1 2.09 0l.175.28a.75.75 0 0 0 1.025.268l.302-.15a.75.75 0 0 1 1.03.317l.544 1.087a.75.75 0 0 1-.317 1.03l-.302.15a.75.75 0 0 0-.39.913l.093.329A.75.75 0 0 1 10.5 6h-.344a.75.75 0 0 0-.721.543L9.22 7a.75.75 0 0 0 .722.543H10.5a.75.75 0 0 1 .705.983l-.093.33a.75.75 0 0 0 .39.912l.302.15a.75.75 0 0 1 .317 1.03l-.544 1.087a.75.75 0 0 1-1.03.317l-.302-.15a.75.75 0 0 0-1.025.268l-.175.28a.75.75 0 0 1-2.09 0l-.175-.28a.75.75 0 0 0-1.025-.268l-.302.15a.75.75 0 0 1-1.03-.317L3.3 10.313a.75.75 0 0 1 .317-1.03l.302-.15a.75.75 0 0 0 .39-.912l-.093-.33A.75.75 0 0 1 5.5 7h.344a.75.75 0 0 0 .721-.543L6.78 6a.75.75 0 0 0-.721-.543H5.5a.75.75 0 0 1-.705-.983l.093-.33a.75.75 0 0 0-.39-.912l-.302-.15a.75.75 0 0 1-.317-1.03l.544-1.087a.75.75 0 0 1 1.03-.317l.302.15a.75.75 0 0 0 1.025-.268l.175-.28ZM8 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Nav items data ───────────────────────────────────────────────────────────

/**
 * NavItemDef — shape of a single navigation item definition.
 */
export interface NavItemDef {
  /** Unique key — used as React key and for active state comparisons. */
  key: string;
  /** Human-readable label shown next to the icon in full mode. */
  label: string;
  /**
   * Href passed to next/link.
   * Map mode items use the path + view search param, e.g. "/inventory?view=M1".
   * Non-map items link to dedicated sub-routes when they exist.
   */
  href: string;
  /**
   * Icon component — a 16×16 SVG rendered as currentColor.
   * Must accept `className` prop for the styles.navIcon CSS class.
   */
  icon: ComponentType<IconProps>;
  /**
   * Optional: the map view ID this item corresponds to ("M1" – "M5").
   * Used to determine the active state based on the `?view=` search param.
   */
  mapView?: "M1" | "M2" | "M3" | "M4" | "M5";
  /**
   * Optional: whether this item is gated behind a feature flag.
   * When false the item is hidden entirely.
   */
  enabled?: boolean;
  /**
   * Visual group for rendering a section divider.
   * "primary" = map mode links (rendered first).
   * "secondary" = utility/admin links (rendered below a divider).
   */
  group: "primary" | "secondary";
}

/**
 * Primary map mode nav items — rendered at the top of the side nav.
 *
 * These link to the INVENTORY map page with a specific `?view=` param.
 * The active state is determined by comparing the current `view` param to
 * the item's `mapView` key.
 *
 * M5 Mission Control is gated behind FF_MAP_MISSION.
 */
const MAP_MODE_NAV_ITEMS: NavItemDef[] = [
  {
    key: "m1-fleet",
    label: "Fleet Overview",
    href: "/inventory?view=M1",
    icon: FleetOverviewIcon,
    mapView: "M1",
    enabled: true,
    group: "primary",
  },
  {
    key: "m2-site",
    label: "Site Detail",
    href: "/inventory?view=M2",
    icon: SiteDetailIcon,
    mapView: "M2",
    enabled: true,
    group: "primary",
  },
  {
    key: "m3-transit",
    label: "Transit",
    href: "/inventory?view=M3",
    icon: TransitTrackerIcon,
    mapView: "M3",
    enabled: true,
    group: "primary",
  },
  {
    key: "m4-deployment",
    label: "Deployment",
    href: "/inventory?view=M4",
    icon: DeploymentIcon,
    mapView: "M4",
    enabled: true,
    group: "primary",
  },
  {
    key: "m5-mission",
    label: "Mission Control",
    href: "/inventory?view=M5",
    icon: MissionControlIcon,
    mapView: "M5",
    enabled: FF_MAP_MISSION,
    group: "primary",
  },
];

/**
 * Secondary utility nav items — rendered below a visual divider.
 *
 * These link to dedicated sub-routes for cases, reports, and admin.
 * Routes are placeholders; pages will be wired in subsequent ACs.
 */
const UTILITY_NAV_ITEMS: NavItemDef[] = [
  {
    key: "cases",
    label: "Cases",
    href: "/inventory/cases",
    icon: CasesIcon,
    enabled: true,
    group: "secondary",
  },
  {
    key: "shipments",
    label: "Shipments",
    href: "/inventory/shipments",
    icon: ShipmentsIcon,
    enabled: true,
    group: "secondary",
  },
  {
    key: "shipments-new",
    label: "+ Shipment",
    href: "/inventory/shipments/new",
    icon: AddIcon,
    enabled: true,
    group: "secondary",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/inventory/reports",
    icon: ReportsIcon,
    enabled: true,
    group: "secondary",
  },
  {
    key: "admin",
    label: "Admin",
    href: "/inventory/admin",
    icon: AdminIcon,
    enabled: true,
    group: "secondary",
  },
];

/**
 * ALL_NAV_ITEMS — the full ordered list, primary then secondary.
 * Exported so tests can inspect/verify the expected structure.
 */
export const ALL_NAV_ITEMS: NavItemDef[] = [
  ...MAP_MODE_NAV_ITEMS,
  ...UTILITY_NAV_ITEMS,
];

// ─── Active state detection ───────────────────────────────────────────────────

/**
 * Determine whether a given nav item should be considered "active" based on
 * the current URL.
 *
 * Rules:
 *  1. If the item has a `mapView` key, it is active when:
 *       - the current path is `/inventory` AND
 *       - the `?view=` param matches the item's mapView, OR
 *       - the `?view=` param is absent and the item's mapView is "M1"
 *         (M1 is the default view).
 *  2. If the item has no `mapView` key (utility routes), it is active when
 *     the current pathname starts with `item.href` (prefix match).
 */
function isNavItemActive(
  item: NavItemDef,
  pathname: string,
  viewParam: string | null,
): boolean {
  if (item.mapView) {
    if (!pathname.startsWith("/inventory")) return false;

    // On /inventory routes: compare against the view param.
    // Absent view param → default to M1.
    const effectiveView = viewParam ?? "M1";
    return effectiveView.toUpperCase() === item.mapView;
  }

  if (item.key === "shipments" && pathname.startsWith("/inventory/shipments/new")) {
    return false;
  }

  // Utility routes: prefix match (handles /inventory/cases, /inventory/admin, etc.)
  return pathname.startsWith(item.href);
}

// ─── NavLink — individual nav link sub-component ──────────────────────────────

interface NavLinkProps {
  item: NavItemDef;
  isActive: boolean;
  /** Optional click callback — used to close the mobile nav drawer on link click. */
  onLinkClick?: () => void;
}

/**
 * NavLink — renders a single styled navigation link using next/link.
 *
 * Uses `aria-current="page"` on the active item to communicate the current
 * location to screen readers without relying on visual-only indicators.
 *
 * The `title` attribute provides a tooltip in collapsed mode (769–1024px)
 * where the label text is visually hidden.  The same attribute also serves
 * as an accessible fallback label for AT that read titles on focusable elements.
 *
 * `onLinkClick` is called on click — the mobile overlay drawer passes this to
 * close itself when the user navigates to a new view.
 *
 * Telemetry: fires INV_NAV_MAP_VIEW_CHANGED (map mode items) or
 * INV_NAV_PAGE_LOADED (utility items) on click to capture the navigation
 * intent at the interaction point, before the URL updates.
 * Note: InventoryMapClient also fires INV_NAV_MAP_VIEW_CHANGED when the
 * URL param actually changes — that event carries the correct previousMapView.
 * The click-site event here records the user's explicit intent.
 */
function NavLink({ item, isActive, onLinkClick }: NavLinkProps) {
  const { label, href, icon: Icon } = item;

  function handleClick() {
    // Emit a navigation intent event so route-change analytics are captured
    // at the click site rather than relying solely on URL-change effects.
    if (item.mapView) {
      // Map mode navigation — fire map view changed event.
      // previousMapView is unknown at click time; the authoritative event with
      // correct previousMapView is emitted by InventoryMapClient's useEffect.
      trackEvent({
        eventCategory: "navigation",
        eventName: TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED,
        app: "inventory",
        mapView: item.mapView,
        previousMapView: null, // resolved by InventoryMapClient on actual URL change
      });
    } else {
      // Utility route navigation — fire a page-load navigation event.
      // loadDurationMs is 0 (unknown at click time; actual timing tracked by
      // the destination page's InventoryMapClient mount effect).
      trackEvent({
        eventCategory: "navigation",
        eventName: TelemetryEventName.INV_NAV_PAGE_LOADED,
        app: "inventory",
        loadDurationMs: 0,
        hydratedFromUrl: false,
      });
    }

    // Call the parent's click handler (e.g. close mobile drawer)
    onLinkClick?.();
  }

  return (
    <Link
      href={href}
      className={styles.navLink}
      data-active={isActive ? "true" : "false"}
      aria-current={isActive ? "page" : undefined}
      /* title shown as tooltip in collapsed icon-strip mode */
      title={label}
      onClick={handleClick}
    >
      <Icon className={styles.navIcon} />
      <span className={styles.navLabel}>{label}</span>
    </Link>
  );
}

// ─── SectionHeading — small uppercase label above a nav group ────────────────

interface SectionHeadingProps {
  children: string;
}

/**
 * SectionHeading — visually shows the section name above a group of nav items.
 * Hidden in collapsed mode (icon-strip); visible in full and mobile overlay.
 */
function SectionHeading({ children }: SectionHeadingProps) {
  return (
    <div className={styles.sectionHeading} aria-hidden="true">
      {children}
    </div>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

/**
 * NavDivider — hairline separator between nav sections.
 */
function NavDivider() {
  return <hr className={styles.divider} role="separator" aria-hidden="true" />;
}

// ─── Main component ───────────────────────────────────────────────────────────

// ─── InventorySideNav props ───────────────────────────────────────────────────

export interface InventorySideNavProps {
  /**
   * Optional callback invoked when any nav link is clicked.
   *
   * Used by InventoryShell to close the mobile overlay drawer whenever the
   * user navigates to a new view — without this the drawer would stay open
   * after a link click, requiring a manual close gesture.
   *
   * Not needed at ≥ 769px because the sidenav is always visible in the grid
   * at those breakpoints.  The callback is safe to call at any viewport width —
   * the parent (InventoryShell) ignores it when the nav is already closed.
   */
  onLinkClick?: () => void;
}

/**
 * InventorySideNav — renders the complete INVENTORY side navigation panel.
 *
 * This component is a Client Component because it uses `usePathname` and
 * `useSearchParams` to determine the active nav item based on the current URL.
 *
 * Rendering structure:
 *   • MAP VIEWS section heading
 *   • M1 Fleet Overview  ──┐
 *   • M2 Site Detail       │  primary group (map modes)
 *   • M3 Transit           │
 *   • M4 Deployment        │
 *   • M5 Mission Control ──┘  (gated: FF_MAP_MISSION)
 *   • ─── divider ───
 *   • MANAGEMENT section heading
 *   • Cases               ──┐
 *   • Reports               │  secondary group (utility routes)
 *   • Admin               ──┘
 *
 * Mobile behaviour:
 *   When the nav is displayed as a mobile overlay drawer (≤ 768px), clicking
 *   any link calls `onLinkClick` — the parent (InventoryShell) uses this to
 *   close the drawer so the full-screen map is immediately visible after navigation.
 */
export function InventorySideNav({ onLinkClick }: InventorySideNavProps = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");

  // Filter to items that are enabled (feature flag check already stored in `enabled`).
  const primaryItems = MAP_MODE_NAV_ITEMS.filter((item) => item.enabled !== false);
  const secondaryItems = UTILITY_NAV_ITEMS.filter((item) => item.enabled !== false);

  return (
    <div className={styles.sideNav} data-testid="inventory-side-nav">
      {/* ── Primary: map mode links ──────────────────────────────────── */}
      <SectionHeading>Map Views</SectionHeading>

      <ul
        className={styles.navList}
        role="list"
        aria-label="Map view navigation"
      >
        {primaryItems.map((item) => {
          const active = isNavItemActive(item, pathname, viewParam);
          return (
            <li key={item.key} className={styles.navItem}>
              <NavLink item={item} isActive={active} onLinkClick={onLinkClick} />
            </li>
          );
        })}
      </ul>

      {/* ── Section divider ──────────────────────────────────────────── */}
      <NavDivider />

      {/* ── Secondary: management / utility links ───────────────────── */}
      <SectionHeading>Management</SectionHeading>

      <ul
        className={styles.navList}
        role="list"
        aria-label="Management navigation"
      >
        {secondaryItems.map((item) => {
          const active = isNavItemActive(item, pathname, viewParam);
          return (
            <li key={item.key} className={styles.navItem}>
              <NavLink item={item} isActive={active} onLinkClick={onLinkClick} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default InventorySideNav;
