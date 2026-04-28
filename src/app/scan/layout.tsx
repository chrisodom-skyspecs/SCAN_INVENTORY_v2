/**
 * SCAN app layout — mobile-first shell
 *
 * Provides the outer chrome for all SCAN mobile app screens:
 *   • Fixed header with SkySpecs wordmark + back navigation
 *   • Scrollable content area (100dvh - header)
 *   • Safe area insets for notched/edge-to-edge devices
 *
 * Typography and colors use design tokens only — no hex literals.
 */

import type { Metadata } from "next";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: {
    template: "%s — SkySpecs SCAN",
    default: "SkySpecs SCAN",
  },
  description: "Field inspection and equipment tracking for SkySpecs technicians.",
};

export default function ScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header} role="banner">
        <div className={styles.headerInner}>
          {/* Wordmark */}
          <span className={styles.wordmark} aria-label="SkySpecs SCAN">
            <span className={styles.wordmarkBrand}>Sky</span>
            <span className={styles.wordmarkProduct}>Specs</span>
            <span className={styles.wordmarkApp}>SCAN</span>
          </span>
        </div>
      </header>

      <main className={styles.main} id="main-content">
        {children}
      </main>
    </div>
  );
}
