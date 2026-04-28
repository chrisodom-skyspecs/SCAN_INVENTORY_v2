/**
 * T3Inspection — Inspection History Panel
 *
 * Shows the current inspection state and progress for a case.
 * Integrates the combined checklist + inspection query so the INVENTORY
 * dashboard operators can see:
 *   - Inspection status and inspector name
 *   - Start / completion timestamps
 *   - Item-level breakdown with damage/missing flags highlighted
 *   - Notes from the inspector
 */

"use client";

import { useChecklistWithInspection } from "../../hooks/use-checklist";
import { useDamageReportsByCase } from "../../hooks/use-damage-reports";
import { StatusPill } from "../StatusPill";
import CustodySection from "./CustodySection";
import shared from "./shared.module.css";
import styles from "./T3Inspection.module.css";
import type { ChecklistWithInspection, ManifestItemStatus } from "../../../convex/checklists";
import type { StatusKind } from "../StatusPill/StatusPill";

// Map manifest item status → nearest StatusKind for StatusPill rendering.
// "unchecked" is not a StatusKind, so we map it to "pending".
const MANIFEST_TO_STATUS_KIND: Record<ManifestItemStatus, StatusKind> = {
  unchecked: "pending",
  ok:        "completed",
  damaged:   "flagged",
  missing:   "exception",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface T3InspectionProps {
  caseId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function T3Inspection({ caseId }: T3InspectionProps) {
  // useChecklistWithInspection is a real-time subscription via Convex.
  // The server-side query loads manifestItems + inspections in a single
  // Promise.all and returns a consistent snapshot. Convex re-runs it whenever
  // either table changes — the T3 panel updates within ~100–300 ms of any SCAN
  // app inspection action without requiring a page reload.
  const data = useChecklistWithInspection(caseId) as ChecklistWithInspection | undefined;

  // useDamageReportsByCase subscribes to getDamageReportsByCase, which joins
  // damaged manifest items with their audit events.  Convex re-runs the query
  // whenever manifestItems or events change, so severity and photo evidence
  // shown in the Issues section reflects SCAN submissions in real-time.
  const damageReports = useDamageReportsByCase(caseId);

  // Build templateItemId → DamageReport lookup for O(1) access in render.
  const damageByTemplateId = new Map(
    (damageReports ?? []).map((r) => [r.templateItemId, r])
  );

  if (data === undefined) {
    return (
      <div className={shared.emptyState} aria-busy="true">
        <div className={shared.spinner} />
      </div>
    );
  }

  const { items, inspection, summary } = data;

  const damagedItems = items.filter((i) => i.status === "damaged");
  const missingItems = items.filter((i) => i.status === "missing");
  const hasIssues    = damagedItems.length > 0 || missingItems.length > 0;

  return (
    <div className={styles.inspection} data-testid="t3-inspection">
      {/* ── Inspection record ─────────────────────────────────────── */}
      {inspection ? (
        <section aria-label="Current inspection">
          <div className={shared.sectionHeader}>
            <h3 className={shared.sectionTitle}>Inspection</h3>
            <StatusPill
              kind={
                (["pending","in_progress","completed","flagged"].includes(inspection.status)
                  ? inspection.status
                  : "pending") as "pending" | "in_progress" | "completed" | "flagged"
              }
            />
          </div>

          <dl className={shared.metaGrid}>
            <div className={shared.metaItem}>
              <dt className={shared.metaLabel}>Inspector</dt>
              <dd className={shared.metaValue}>{inspection.inspectorName}</dd>
            </div>

            {inspection.startedAt && (
              <div className={shared.metaItem}>
                <dt className={shared.metaLabel}>Started</dt>
                <dd className={`${shared.metaValue} ${shared.timestamp}`}>
                  {formatDate(inspection.startedAt)}
                </dd>
              </div>
            )}

            {inspection.completedAt && (
              <div className={shared.metaItem}>
                <dt className={shared.metaLabel}>Completed</dt>
                <dd className={`${shared.metaValue} ${shared.timestamp}`}>
                  {formatDate(inspection.completedAt)}
                </dd>
              </div>
            )}
          </dl>

          {inspection.notes && (
            <p className={shared.noteBlock}>{inspection.notes}</p>
          )}
        </section>
      ) : (
        <div className={shared.emptyState}>
          <p className={shared.emptyStateTitle}>No inspection started</p>
          <p className={shared.emptyStateText}>
            Field technicians can start an inspection from the SCAN app.
          </p>
        </div>
      )}

      <hr className={shared.divider} />

      {/* ── Progress summary ──────────────────────────────────────── */}
      <section aria-label="Inspection progress">
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>Progress</h3>
          <span className={shared.timestamp}>
            {summary.ok + summary.damaged + summary.missing} / {summary.total} reviewed
          </span>
        </div>

        <div className={shared.progressBar}>
          <div
            className={shared.progressTrack}
            role="progressbar"
            aria-valuenow={summary.progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Inspection progress: ${summary.progressPct}%`}
          >
            <div
              className={[
                shared.progressFill,
                hasIssues ? shared.progressFillDamaged : "",
              ].filter(Boolean).join(" ")}
              style={{ width: `${summary.progressPct}%` }}
            />
          </div>
          <div className={shared.progressMeta}>
            <span>{summary.progressPct}%</span>
            <span className={styles.counters}>
              {summary.ok > 0 && (
                <span className={styles.counterOk}>{summary.ok} OK</span>
              )}
              {summary.damaged > 0 && (
                <span className={styles.counterIssue}>{summary.damaged} damaged</span>
              )}
              {summary.missing > 0 && (
                <span className={styles.counterIssue}>{summary.missing} missing</span>
              )}
            </span>
          </div>
        </div>
      </section>

      {/* ── Custody — compact current custodian ──────────────────── */}
      {/*
        Sub-AC 36d-3: CustodySection (compact) subscribes to
        api.custody.getLatestCustodyRecord via useLatestCustodyRecord.
        Convex re-evaluates and pushes within ~100–300 ms of any
        handoffCustody mutation — the custodian shown here always
        reflects the real-time state without a page reload.
      */}
      <hr className={shared.divider} />
      <CustodySection caseId={caseId} variant="compact" />

      {/* ── Issues list — only shown when there are damaged/missing items ── */}
      {hasIssues && (
        <>
          <hr className={shared.divider} />
          <section aria-label="Items requiring attention">
            <div className={shared.sectionHeader}>
              <h3 className={shared.sectionTitle}>Issues</h3>
            </div>

            <ul className={styles.issueList} aria-label="Items with issues">
              {[...damagedItems, ...missingItems].map((item) => {
                // Damage report for this item (undefined if missing or not yet loaded).
                const damageReport = item.status === "damaged"
                  ? damageByTemplateId.get(item.templateItemId)
                  : undefined;

                return (
                  <li key={item._id} className={styles.issueItem}>
                    <div className={styles.issueItemHeader}>
                      <StatusPill kind={MANIFEST_TO_STATUS_KIND[item.status as ManifestItemStatus] ?? "pending"} />
                      {/* Severity badge — reflects SCAN damage report submission in real-time */}
                      {damageReport?.severity && (
                        <span
                          className={[
                            styles.severityBadge,
                            styles[`severity-${damageReport.severity}`],
                          ].filter(Boolean).join(" ")}
                          aria-label={`Severity: ${damageReport.severity}`}
                        >
                          {damageReport.severity}
                        </span>
                      )}
                      <span className={styles.issueName}>{item.name}</span>
                    </div>
                    {/* Photo evidence indicator */}
                    {damageReport && damageReport.photoStorageIds.length > 0 && (
                      <p className={styles.issuePhotos}>
                        {damageReport.photoStorageIds.length} photo{damageReport.photoStorageIds.length !== 1 ? "s" : ""}
                        {damageReport.reportedByName && (
                          <span className={shared.timestamp}> · {damageReport.reportedByName}</span>
                        )}
                      </p>
                    )}
                    {item.notes && (
                      <p className={styles.issueNote}>{item.notes}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
