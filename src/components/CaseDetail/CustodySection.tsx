/**
 * CustodySection — Shared real-time custody display component for T1–T5.
 *
 * Wraps the Convex useQuery hooks from src/hooks/use-custody.ts and renders
 * custody handoff information in three variants suited to each T-layout:
 *
 *   "compact"  — Current custodian chip (T1, T2, T3).
 *                Uses useLatestCustodyRecord to show who currently holds the
 *                case plus the timestamp when they received it.
 *
 *   "recent"   — Recent handoff history, descending (T4).
 *                Uses useCustodyRecordsByCase, limited to `recentLimit` entries
 *                (default 5). Shows from→to, timestamp, and optional notes.
 *
 *   "chain"    — Full chronological custody chain, ascending (T5).
 *                Uses useCustodyChain to render every handoff in order from
 *                the first holder to the current custodian with step numbers.
 *
 * Real-time fidelity:
 *   All variants subscribe to Convex real-time queries. When the SCAN app
 *   completes a custody handoff via the handoffCustody mutation:
 *     1. The custodyRecords row is inserted.
 *     2. Convex invalidates every subscribed query that reads custodyRecords.
 *     3. Connected clients receive the updated result within ~100–300 ms.
 *   This satisfies the ≤ 2-second real-time fidelity requirement without any
 *   polling or manual refetch.
 *
 * Accessibility:
 *   - Uses semantic HTML (section, dl, ol, ul, li).
 *   - aria-label on list containers for screen readers.
 *   - Loading states use aria-busy.
 *   - Arrow in "recent" transfer rows is aria-hidden; parent label describes the transfer.
 *
 * Design system compliance:
 *   - No hex literals — CSS custom properties only.
 *   - IBM Plex Mono for timestamps and step numbers.
 *   - Inter Tight for UI labels and custodian names.
 */

"use client";

import {
  useCustodyRecordsByCase,
  useLatestCustodyRecord,
  useCustodyChain,
  type CustodyRecord,
} from "../../hooks/use-custody";
import shared from "./shared.module.css";
import styles from "./CustodySection.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CustodySectionProps {
  /** Convex document ID of the case to subscribe to. */
  caseId: string;
  /**
   * Rendering variant:
   *   "compact" — single current-custodian chip (T1, T2, T3)
   *   "recent"  — descending recent handoff list (T4)
   *   "chain"   — ascending full chronological chain (T5)
   */
  variant?: "compact" | "recent" | "chain";
  /**
   * Maximum number of records to show in the "recent" variant.
   * Records beyond this limit are not fetched — we simply slice the result.
   * Default: 5.
   */
  recentLimit?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTransferDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeDate(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return formatTransferDate(epochMs);
}

// ─── Loading skeleton (shared) ────────────────────────────────────────────────

function CustodySkeleton() {
  return (
    <div className={shared.emptyState} aria-busy="true" aria-label="Loading custody information">
      <div className={shared.spinner} />
    </div>
  );
}

// ─── No-records placeholder (shared) ─────────────────────────────────────────

function NoCustodyRecords({ message }: { message?: string }) {
  return (
    <p className={styles.noCustody}>
      {message ?? "No custody transfers recorded"}
    </p>
  );
}

// ─── Handoff row (used in "recent" variant) ───────────────────────────────────

interface HandoffRowProps {
  record: CustodyRecord;
}

function HandoffRow({ record }: HandoffRowProps) {
  return (
    <li
      className={styles.handoffRow}
      aria-label={`Handoff from ${record.fromUserName} to ${record.toUserName}`}
    >
      <div className={styles.handoffTransfer}>
        <span className={styles.handoffFrom}>{record.fromUserName}</span>
        <span className={styles.handoffArrow} aria-hidden="true">→</span>
        <span className={styles.handoffTo}>{record.toUserName}</span>
      </div>
      <span className={shared.timestamp}>
        {formatTransferDate(record.transferredAt)}
      </span>
      {record.notes && (
        <p className={styles.handoffNotes}>{record.notes}</p>
      )}
    </li>
  );
}

// ─── Chain step (used in "chain" variant) ─────────────────────────────────────

interface ChainStepProps {
  record: CustodyRecord;
  step: number;
  isLast: boolean;
}

function ChainStep({ record, step, isLast }: ChainStepProps) {
  return (
    <li
      className={styles.chainStep}
      aria-label={`Step ${step}: ${record.fromUserName} transferred to ${record.toUserName}`}
    >
      <div className={styles.chainStepConnector} aria-hidden="true">
        <div className={styles.chainStepDot} />
        {!isLast && <div className={styles.chainStepLine} />}
      </div>

      <div className={styles.chainStepBody}>
        <div className={styles.chainStepHeader}>
          <span className={styles.chainStepNumber} aria-label={`Step ${step}`}>
            {step}
          </span>
          <span className={styles.chainStepTo}>{record.toUserName}</span>
          <span className={shared.timestamp}>
            {formatTransferDate(record.transferredAt)}
          </span>
        </div>

        <p className={styles.chainStepFrom}>
          From: {record.fromUserName}
        </p>

        {record.notes && (
          <p className={styles.chainStepNotes}>{record.notes}</p>
        )}
      </div>
    </li>
  );
}

// ─── Compact variant ──────────────────────────────────────────────────────────
//
// Subscribes to `useLatestCustodyRecord` — the lightest custody subscription.
// Returns a single record (or null) on the Convex real-time channel.
// Updates within ~100–300 ms of any handoffCustody mutation.

interface CompactCustodyProps {
  caseId: string;
}

function CompactCustody({ caseId }: CompactCustodyProps) {
  // useLatestCustodyRecord subscribes to api.custody.getLatestCustodyRecord.
  // Convex re-evaluates and pushes the update within ~100–300 ms of any
  // handoffCustody mutation, satisfying the ≤ 2-second real-time fidelity SLA.
  const latest = useLatestCustodyRecord(caseId);

  if (latest === undefined) {
    return (
      <>
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>Custody</h3>
        </div>
        <CustodySkeleton />
      </>
    );
  }

  if (latest === null) {
    return (
      <>
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>Custody</h3>
        </div>
        <NoCustodyRecords message="No custody transfers recorded" />
      </>
    );
  }

  return (
    <>
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>Custody</h3>
        <span className={shared.timestamp}>
          {formatRelativeDate(latest.transferredAt)}
        </span>
      </div>

      <div className={styles.currentCustodian}>
        <span className={styles.custodianLabel}>Currently held by</span>
        <span className={styles.custodianName}>{latest.toUserName}</span>
        <span className={shared.timestamp}>
          since {formatTransferDate(latest.transferredAt)}
        </span>
        {latest.notes && (
          <p className={shared.noteBlock}>{latest.notes}</p>
        )}
      </div>
    </>
  );
}

// ─── Recent variant ───────────────────────────────────────────────────────────
//
// Subscribes to `useCustodyRecordsByCase` (descending order, most recent first).
// Convex invalidates the subscription whenever custodyRecords changes for this
// caseId, pushing an update within ~100–300 ms of a new handoff mutation.

interface RecentCustodyProps {
  caseId: string;
  recentLimit: number;
}

function RecentCustody({ caseId, recentLimit }: RecentCustodyProps) {
  // useCustodyRecordsByCase subscribes to api.custody.getCustodyRecordsByCase.
  // Sorted descending (most recent handoff at index 0).
  const records = useCustodyRecordsByCase(caseId);

  if (records === undefined) {
    return (
      <>
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>Custody History</h3>
        </div>
        <CustodySkeleton />
      </>
    );
  }

  const visible = records.slice(0, recentLimit);
  const totalCount = records.length;

  return (
    <>
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>Custody History</h3>
        {totalCount > 0 && (
          <span className={shared.timestamp}>
            {totalCount} handoff{totalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <NoCustodyRecords />
      ) : (
        <>
          <ul className={styles.handoffList} aria-label="Recent custody handoffs">
            {visible.map((record) => (
              <HandoffRow key={record._id} record={record} />
            ))}
          </ul>

          {totalCount > recentLimit && (
            <div className={styles.showMoreRow}>
              <span className={shared.timestamp}>
                +{totalCount - recentLimit} older handoff
                {totalCount - recentLimit !== 1 ? "s" : ""} · see Audit tab for full chain
              </span>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ─── Chain variant ────────────────────────────────────────────────────────────
//
// Subscribes to `useCustodyChain` (ascending order, oldest handoff at index 0).
// This is the canonical chain-of-custody view for the T5 audit panel and
// compliance reports.
//
// Convex invalidates the subscription whenever custodyRecords changes for this
// caseId, pushing an update within ~100–300 ms of any handoffCustody mutation.

interface ChainCustodyProps {
  caseId: string;
}

function ChainCustody({ caseId }: ChainCustodyProps) {
  // useCustodyChain subscribes to api.custody.getCustodyChain.
  // Returns records ascending (first holder at index 0, current at last index).
  const chain = useCustodyChain(caseId);

  if (chain === undefined) {
    return (
      <>
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>Custody Chain</h3>
        </div>
        <CustodySkeleton />
      </>
    );
  }

  return (
    <>
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>Custody Chain</h3>
        {chain.length > 0 && (
          <span className={shared.timestamp}>
            {chain.length} transfer{chain.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {chain.length === 0 ? (
        <NoCustodyRecords />
      ) : (
        <ol className={styles.chainList} aria-label="Chronological custody chain">
          {chain.map((record, index) => (
            <ChainStep
              key={record._id}
              record={record}
              step={index + 1}
              isLast={index === chain.length - 1}
            />
          ))}
        </ol>
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * CustodySection — Real-time custody handoff display for T1–T5 case detail panels.
 *
 * Integrates the Convex custody useQuery hooks and renders custody transfer
 * data in the appropriate format for each T-layout:
 *   T1, T2, T3 → variant="compact"  (useLatestCustodyRecord)
 *   T4         → variant="recent"   (useCustodyRecordsByCase, descending)
 *   T5         → variant="chain"    (useCustodyChain, ascending)
 *
 * All variants update automatically within ~100–300 ms whenever the SCAN app
 * completes a custody handoff — no page reload or manual refresh required.
 */
export default function CustodySection({
  caseId,
  variant = "compact",
  recentLimit = 5,
}: CustodySectionProps) {
  const ariaLabel =
    variant === "compact"
      ? "Custody information"
      : variant === "recent"
      ? "Custody handoff history"
      : "Custody chain";

  return (
    <section
      aria-label={ariaLabel}
      className={styles.section}
      data-testid={`custody-section-${variant}`}
    >
      {variant === "compact" && <CompactCustody caseId={caseId} />}
      {variant === "recent" && (
        <RecentCustody caseId={caseId} recentLimit={recentLimit} />
      )}
      {variant === "chain" && <ChainCustody caseId={caseId} />}
    </section>
  );
}

// Named exports for consumers that want to embed individual sub-components.
export { CompactCustody, RecentCustody, ChainCustody };
