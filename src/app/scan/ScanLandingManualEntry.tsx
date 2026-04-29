/**
 * ScanLandingManualEntry.tsx — client component
 *
 * Manual case-ID entry form on the SCAN landing page.
 * Handles form submit and navigates to /scan/<caseId>.
 * Kept as a minimal client component so the parent page.tsx
 * can remain a server component (reading the Kinde session).
 */

"use client";

import { type FormEvent, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./scan-landing.module.css";

export function ScanLandingManualEntry() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = inputRef.current?.value.trim() ?? "";
    if (!raw) return;
    // Normalise: uppercase, strip any accidental leading slash
    const caseId = raw.replace(/^\//, "").toUpperCase();
    router.push(`/scan/${encodeURIComponent(caseId)}`);
  }

  return (
    <section className={styles.manual} aria-label="Manual case entry">
      <p className={styles.manualLabel}>Or enter a Case ID manually</p>
      <form
        className={styles.manualForm}
        onSubmit={handleSubmit}
        role="search"
        aria-label="Case ID search"
      >
        <label htmlFor="caseId" className={styles.manualInputLabel}>
          Case ID
        </label>
        <div className={styles.manualInputRow}>
          <input
            id="caseId"
            ref={inputRef}
            type="text"
            className={styles.manualInput}
            placeholder="CASE-001"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Enter case ID"
          />
          <button type="submit" className={styles.manualButton} aria-label="Open case">
            Open
          </button>
        </div>
      </form>
    </section>
  );
}
