/**
 * T1Shell — 50/50 CSS grid container for the T1 Summary layout.
 *
 * Renders two equal-width panels side-by-side within the INVENTORY
 * case detail panel. Left panel shows primary case identity information;
 * right panel shows current operational status data.
 *
 * Layout behaviour:
 *   - `display: grid; grid-template-columns: 1fr 1fr` — equal 50/50 split.
 *   - A 1px border-right on the left panel acts as the visual column divider.
 *   - Stacks to a single column at ≤ 48rem (see T1Shell.module.css) so the
 *     layout degrades gracefully in the narrow docked side panel and on
 *     mobile viewports.
 *
 * Integration:
 *   Used by T1Overview, which is lazy-loaded by CaseDetailPanel when
 *   `window === "T1"`. The shell is therefore automatically integrated into
 *   the T1–T5 tab router/switcher without any change to CaseDetailPanel.
 *
 * Props:
 *   leftPanel  — Content for the left panel (identity: header, metadata,
 *                custody, notes).
 *   rightPanel — Content for the right panel (status: FedEx tracking,
 *                checklist progress, damage summary).
 */

import type { ReactNode } from "react";
import styles from "./T1Shell.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface T1ShellProps {
  /**
   * Content for the left panel.
   *
   * Typically renders either:
   *   - T1MapPanel (interactive Mapbox GL JS mini-map, edge-to-edge) when
   *     `leftPanelHasMap` is true.
   *   - Case identity info (header, metadata, custody, notes) when false.
   */
  leftPanel: ReactNode;
  /**
   * Content for the right panel.
   *
   * Typically renders operational state: FedEx tracking compact badge,
   * checklist progress bar, and damage summary section.  When `leftPanelHasMap`
   * is true, also includes the case identity info (header, metadata, etc.)
   * that otherwise lives in the left panel.
   */
  rightPanel: ReactNode;
  /**
   * When true, strips the standard 1.25rem padding from the left panel and
   * sets overflow: hidden so the content (e.g. T1MapPanel) can fill the cell
   * edge-to-edge using position: absolute; inset: 0.
   *
   * Default: false — left panel uses standard scrollable padding layout.
   */
  leftPanelHasMap?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * T1Shell renders a 50/50 CSS grid container with two equal panels.
 *
 * The shell itself carries no data dependencies — it is a pure layout
 * primitive that receives its panel content as props.  All Convex
 * subscriptions, feature-flag checks, and business logic live in
 * T1Overview (or its sub-components), which compose T1Shell.
 *
 * When `leftPanelHasMap` is true, the left panel uses the `.panelLeftMap`
 * CSS class which removes padding and hides overflow, enabling T1MapPanel
 * (or any position: absolute fill content) to occupy the full cell area.
 */
export function T1Shell({ leftPanel, rightPanel, leftPanelHasMap = false }: T1ShellProps) {
  // Compose the left panel class: use panelLeftMap (no padding, overflow hidden)
  // when hosting a map component, otherwise use panelLeft (standard padded layout).
  const leftPanelClass = [
    styles.panel,
    leftPanelHasMap ? styles.panelLeftMap : styles.panelLeft,
  ].join(" ");

  return (
    <div
      className={styles.shell}
      data-testid="t1-shell"
      aria-label="Case summary — two-panel layout"
    >
      {/* Left panel: map panel (when leftPanelHasMap) or case identity info */}
      <div
        className={leftPanelClass}
        data-testid="t1-shell-left"
        data-has-map={leftPanelHasMap ? "true" : undefined}
        aria-label={leftPanelHasMap ? "Case location map panel" : "Case identity panel"}
      >
        {leftPanel}
      </div>

      {/* Right panel: operational status data (and case identity when map is left) */}
      <div
        className={`${styles.panel} ${styles.panelRight}`}
        data-testid="t1-shell-right"
        aria-label="Case status panel"
      >
        {rightPanel}
      </div>
    </div>
  );
}

export default T1Shell;
