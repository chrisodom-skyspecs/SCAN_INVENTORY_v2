/**
 * DossierEvidencePanel — Evidence tab content for the T4 Tabbed Dossier.
 *
 * Rendered in the "Evidence" tab of T4DossierShell (used under the
 * FF_INV_REDESIGN code path).  Provides an operator-facing overview of all
 * damage evidence documented by field technicians:
 *
 *   Inspection report header  — inspector name, dates, status pill, progress bar.
 *   Damage summary strip      — counts of damaged / missing / ok items.
 *   Photo gallery             — full-width grid of annotated damage photos
 *                               with severity badges, annotation pin overlays,
 *                               metadata rows, and expanded annotation lists.
 *   Item-level damage cards   — one card per damaged manifest item, grouping
 *                               photos by item with notes and reporter info.
 *   Empty state               — clear guidance when no damage has been reported.
 *
 * Real-time fidelity (≤ 2 seconds):
 *   Three Convex subscriptions back this panel — all re-evaluate and push
 *   within ~100–300 ms of any SCAN app action:
 *
 *     useDamagePhotoReportsWithUrls   → photos with server-resolved URLs +
 *                                       annotation pin data (x, y, label, color)
 *     useDamageReportsByCase          → per-item damage records joined with
 *                                       audit events (severity, reporter, notes)
 *     useChecklistWithInspection      → inspection header metadata + progress
 *
 * Design-system compliance:
 *   • No hex literals — CSS custom properties only.
 *   • Inter Tight for all UI typography.
 *   • IBM Plex Mono for timestamps, IDs, and data values.
 *   • StatusPill for all status indicators.
 *   • WCAG AA contrast in both light and dark themes.
 *   • prefers-reduced-motion respected in all CSS animations.
 *
 * @example
 *   // Used inside T4DossierShell as the "evidence" tab content:
 *   if (tab === "evidence") {
 *     return <DossierEvidencePanel caseId={caseId} />;
 *   }
 */

"use client";

import { useState } from "react";
import { useDamagePhotoReportsWithUrls, useDamageReportsByCase } from "../../hooks/use-damage-reports";
import { useChecklistWithInspection } from "../../hooks/use-checklist";
import type { DamagePhotoReportWithUrl, DamageReport } from "../../hooks/use-damage-reports";
import type { ChecklistWithInspection } from "../../../convex/checklists";
import { StatusPill } from "../StatusPill";
import shared from "./shared.module.css";
import styles from "./DossierEvidencePanel.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DossierEvidencePanelProps {
  /** Convex document ID of the case to display evidence for. */
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

function formatShortDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Derive user initials from a display name string. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] ?? "?").toUpperCase();
  return ((parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

// ─── Sub-component: Loading skeleton ──────────────────────────────────────────

function EvidenceSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading evidence data">
      <div className={styles.skeletonHeader} />
      <div className={styles.skeletonSummary} />
      <div className={styles.skeletonGallery}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.skeletonPhoto} />
        ))}
      </div>
      <div className={styles.skeletonCard} />
      <div className={styles.skeletonCard} />
    </div>
  );
}

// ─── Sub-component: Empty state ───────────────────────────────────────────────

function EvidenceEmptyState() {
  return (
    <div className={shared.emptyState} data-testid="evidence-empty-state">
      {/* Camera icon */}
      <svg
        className={shared.emptyStateIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
      <p className={shared.emptyStateTitle}>No damage evidence recorded</p>
      <p className={shared.emptyStateText}>
        Field technicians can report damage with annotated photos from the SCAN app.
        Evidence appears here in real time as reports are submitted.
      </p>
    </div>
  );
}

// ─── Sub-component: Inspection report header ──────────────────────────────────

interface InspectionHeaderProps {
  data: ChecklistWithInspection;
}

function InspectionHeader({ data }: InspectionHeaderProps) {
  const { inspection, summary, items } = data;

  const damagedCount = items.filter((i) => i.status === "damaged").length;
  const missingCount = items.filter((i) => i.status === "missing").length;
  const hasIssues = damagedCount > 0 || missingCount > 0;

  // Resolve inspection status to a valid StatusPill kind
  const pillKind = (
    ["pending", "in_progress", "completed", "flagged"].includes(inspection?.status ?? "")
      ? (inspection?.status as "pending" | "in_progress" | "completed" | "flagged")
      : "pending"
  );

  return (
    <section
      className={styles.inspectionHeader}
      aria-label="Inspection report summary"
      data-testid="evidence-inspection-header"
    >
      <div className={shared.sectionHeader}>
        <h2 className={shared.sectionTitle}>Inspection Report</h2>
        {inspection && <StatusPill kind={pillKind} />}
      </div>

      {inspection ? (
        <>
          {/* Inspector metadata row */}
          <dl className={styles.inspectionMeta}>
            <div className={styles.inspectionMetaItem}>
              <dt className={shared.metaLabel}>Inspector</dt>
              <dd className={shared.metaValue}>{inspection.inspectorName}</dd>
            </div>

            {inspection.startedAt && (
              <div className={styles.inspectionMetaItem}>
                <dt className={shared.metaLabel}>Started</dt>
                <dd className={`${shared.metaValue} ${shared.timestamp}`}>
                  {formatDate(inspection.startedAt)}
                </dd>
              </div>
            )}

            {inspection.completedAt && (
              <div className={styles.inspectionMetaItem}>
                <dt className={shared.metaLabel}>Completed</dt>
                <dd className={`${shared.metaValue} ${shared.timestamp}`}>
                  {formatDate(inspection.completedAt)}
                </dd>
              </div>
            )}
          </dl>

          {/* Inspection notes */}
          {inspection.notes && (
            <p className={shared.noteBlock}>{inspection.notes}</p>
          )}

          {/* Damage / progress summary strip */}
          <div className={styles.summaryStrip}>
            <div className={styles.summaryStatCell}>
              <span className={styles.summaryStatValue}>{summary.total}</span>
              <span className={styles.summaryStatLabel}>Total Items</span>
            </div>
            <div className={styles.summaryStatSep} aria-hidden="true" />
            <div className={styles.summaryStatCell}>
              <span
                className={[
                  styles.summaryStatValue,
                  summary.ok > 0 ? styles.summaryStatOk : "",
                ].filter(Boolean).join(" ")}
              >
                {summary.ok}
              </span>
              <span className={styles.summaryStatLabel}>OK</span>
            </div>
            <div className={styles.summaryStatSep} aria-hidden="true" />
            <div className={styles.summaryStatCell}>
              <span
                className={[
                  styles.summaryStatValue,
                  damagedCount > 0 ? styles.summaryStatDamaged : "",
                ].filter(Boolean).join(" ")}
              >
                {damagedCount}
              </span>
              <span className={styles.summaryStatLabel}>Damaged</span>
            </div>
            <div className={styles.summaryStatSep} aria-hidden="true" />
            <div className={styles.summaryStatCell}>
              <span
                className={[
                  styles.summaryStatValue,
                  missingCount > 0 ? styles.summaryStatMissing : "",
                ].filter(Boolean).join(" ")}
              >
                {missingCount}
              </span>
              <span className={styles.summaryStatLabel}>Missing</span>
            </div>
          </div>

          {/* Progress bar */}
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
              <span>{summary.progressPct}% complete</span>
              <span className={shared.timestamp}>
                {summary.ok + summary.damaged + summary.missing} / {summary.total} reviewed
              </span>
            </div>
          </div>
        </>
      ) : (
        <p className={styles.noInspectionNote}>
          No inspection has been started for this case. Field technicians can begin
          an inspection from the SCAN app.
        </p>
      )}
    </section>
  );
}

// ─── Sub-component: Severity badge ───────────────────────────────────────────

interface SeverityBadgeProps {
  severity: "minor" | "moderate" | "severe";
}

function SeverityBadge({ severity }: SeverityBadgeProps) {
  const LABELS: Record<string, string> = {
    minor: "Minor",
    moderate: "Moderate",
    severe: "Severe",
  };

  return (
    <span
      className={[styles.severityBadge, styles[`severity-${severity}`]].filter(Boolean).join(" ")}
      aria-label={`Severity: ${LABELS[severity] ?? severity}`}
    >
      {LABELS[severity] ?? severity}
    </span>
  );
}

// ─── Sub-component: Photo card ────────────────────────────────────────────────

interface PhotoCardProps {
  photo: DamagePhotoReportWithUrl;
  /** Item name to show in the card header, if linked to a manifest item. */
  itemName?: string;
  /** Whether the annotation list is expanded. */
  annotationsExpanded: boolean;
  onToggleAnnotations: () => void;
}

function PhotoCard({
  photo,
  itemName,
  annotationsExpanded,
  onToggleAnnotations,
}: PhotoCardProps) {
  const annotationCount = photo.annotations.length;

  return (
    <article
      className={styles.photoCard}
      data-testid="evidence-photo-card"
      aria-label={`Damage photo — severity: ${photo.severity}${itemName ? ` for ${itemName}` : ""}`}
    >
      {/* ── Photo image + annotation overlay ──────────────────── */}
      <div className={styles.photoWrap}>
        {photo.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.photoUrl}
            alt={`Damage evidence${itemName ? ` for ${itemName}` : ""}${photo.notes ? `: ${photo.notes}` : ""}`}
            className={styles.photoImg}
            loading="lazy"
          />
        ) : (
          <div
            className={styles.photoPlaceholder}
            aria-label="Photo unavailable"
            role="img"
          />
        )}

        {/* Annotation pin overlays — decorative, aria-hidden */}
        {annotationCount > 0 && (
          <div
            className={styles.annotationOverlay}
            aria-hidden="true"
          >
            {photo.annotations.map((ann, idx) => (
              <span
                key={idx}
                className={styles.annotationPin}
                style={{
                  left: `${ann.x * 100}%`,
                  top:  `${ann.y * 100}%`,
                  // Use annotation color when provided.
                  // No hex literals in JSX — fallback is a CSS token.
                  background:  ann.color ?? "var(--signal-error-fill)",
                  borderColor: ann.color ?? "var(--signal-error-border)",
                }}
                title={ann.label}
              />
            ))}
          </div>
        )}

        {/* Severity badge — overlaid bottom-left */}
        <div className={styles.photoBadgeOverlay}>
          <SeverityBadge severity={photo.severity} />
        </div>

        {/* Annotation count badge — overlaid bottom-right */}
        {annotationCount > 0 && (
          <span
            className={styles.annotationCountBadge}
            aria-label={`${annotationCount} annotation${annotationCount !== 1 ? "s" : ""}`}
          >
            {annotationCount}
          </span>
        )}
      </div>

      {/* ── Card metadata ──────────────────────────────────────── */}
      <div className={styles.photoMeta}>
        {/* Item link + reporter row */}
        <div className={styles.photoMetaRow}>
          {/* Reporter avatar + name */}
          <span
            className={styles.reporterAvatar}
            aria-hidden="true"
            title={photo.reportedByName}
          >
            {getInitials(photo.reportedByName)}
          </span>
          <span className={styles.reporterName}>{photo.reportedByName}</span>

          {/* Timestamp */}
          <time
            className={shared.timestamp}
            dateTime={new Date(photo.reportedAt).toISOString()}
          >
            {formatShortDate(photo.reportedAt)}
          </time>
        </div>

        {/* Item name (linked manifest item) */}
        {itemName && (
          <p className={styles.photoItemLink}>
            <span className={styles.photoItemLinkLabel}>Item:</span>
            {itemName}
          </p>
        )}

        {/* Technician notes */}
        {photo.notes && (
          <p className={styles.photoNotes}>{photo.notes}</p>
        )}

        {/* Annotation toggle button + detail list */}
        {annotationCount > 0 && (
          <>
            <button
              type="button"
              className={styles.annotationToggleBtn}
              onClick={onToggleAnnotations}
              aria-expanded={annotationsExpanded}
              aria-controls={`annotation-list-${photo.id}`}
            >
              <svg
                className={[
                  styles.annotationToggleChevron,
                  annotationsExpanded ? styles.annotationToggleChevronOpen : "",
                ].filter(Boolean).join(" ")}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="4 6 8 10 12 6" />
              </svg>
              {annotationsExpanded ? "Hide" : "Show"}{" "}
              {annotationCount} annotation{annotationCount !== 1 ? "s" : ""}
            </button>

            {annotationsExpanded && (
              <ol
                id={`annotation-list-${photo.id}`}
                className={styles.annotationList}
                aria-label={`Annotation pins for this photo`}
              >
                {photo.annotations.map((ann, idx) => (
                  <li key={idx} className={styles.annotationListItem}>
                    {/* Pin color swatch */}
                    <span
                      className={styles.annotationSwatch}
                      style={{
                        background:  ann.color ?? "var(--signal-error-fill)",
                        borderColor: ann.color ?? "var(--signal-error-border)",
                      }}
                      aria-hidden="true"
                    />
                    <span className={styles.annotationIndex}>#{idx + 1}</span>
                    <span className={styles.annotationLabel}>{ann.label}</span>
                    <span className={styles.annotationCoords}>
                      {Math.round(ann.x * 100)}%, {Math.round(ann.y * 100)}%
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </article>
  );
}

// ─── Sub-component: Damage item card ─────────────────────────────────────────
//
// Shows metadata for a single damaged manifest item.
// Photos are NOT embedded here — they are shown in the main photo gallery
// above to avoid duplication.  A "photo count" note is shown when photos exist.

interface DamageItemCardProps {
  report: DamageReport;
  /** Count of linked photos already displayed in the gallery above. */
  photoCount: number;
}

function DamageItemCard({
  report,
  photoCount,
}: DamageItemCardProps) {
  return (
    <article
      className={styles.damageItemCard}
      data-testid="evidence-damage-item-card"
      aria-label={`Damage report for ${report.itemName}`}
    >
      {/* ── Card header ────────────────────────────────────────── */}
      <div className={styles.damageItemHeader}>
        <StatusPill kind="flagged" />
        {report.severity && (
          <SeverityBadge severity={report.severity as "minor" | "moderate" | "severe"} />
        )}
        <h3 className={styles.damageItemName}>{report.itemName}</h3>
      </div>

      {/* ── Metadata row ───────────────────────────────────────── */}
      <dl className={styles.damageItemMeta}>
        {report.reportedByName && (
          <div className={styles.damageItemMetaItem}>
            <dt className={shared.metaLabel}>Reported by</dt>
            <dd className={shared.metaValue}>
              <span
                className={styles.reporterAvatarSmall}
                aria-hidden="true"
              >
                {getInitials(report.reportedByName)}
              </span>
              {report.reportedByName}
            </dd>
          </div>
        )}

        {report.reportedAt && (
          <div className={styles.damageItemMetaItem}>
            <dt className={shared.metaLabel}>Reported at</dt>
            <dd className={`${shared.metaValue} ${shared.timestamp}`}>
              {formatDate(report.reportedAt)}
            </dd>
          </div>
        )}
      </dl>

      {/* ── Notes ──────────────────────────────────────────────── */}
      {report.notes && (
        <p className={shared.noteBlock}>{report.notes}</p>
      )}

      {/* Photo reference — links to gallery above rather than duplicating cards */}
      {photoCount > 0 && (
        <p className={styles.photoCountNote}>
          {photoCount} photo{photoCount !== 1 ? "s" : ""} — see gallery above
        </p>
      )}
    </article>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * DossierEvidencePanel
 *
 * Renders the Evidence tab within the T4DossierShell for a selected case.
 * Displays:
 *   1. Inspection report header with status, inspector name, timestamps,
 *      damage counts, and inspection progress bar.
 *   2. Chronological photo gallery — all damage photos submitted across all
 *      items, sorted newest-first, with annotation overlays and metadata.
 *   3. Item-level damage cards — one card per damaged manifest item, grouping
 *      that item's photos beneath the item header.
 *
 * State management:
 *   - `expandedPhotoIds`: tracks which photo annotation lists are open.
 *     Photo annotation lists are collapsed by default for a cleaner gallery view;
 *     tapping "Show N annotations" expands the labelled pin list.
 *
 * Real-time fidelity:
 *   Three Convex subscriptions back this panel.  All re-evaluate and push
 *   within ~100–300 ms of any SCAN app action (damage photo submission,
 *   inspection start/complete, item check), satisfying the ≤ 2-second SLA.
 */
export function DossierEvidencePanel({ caseId }: DossierEvidencePanelProps) {
  // ── Convex subscriptions ────────────────────────────────────────────────────

  /**
   * Damage photo reports with server-resolved URLs.
   * Re-evaluates within ~100–300 ms of any submitDamagePhoto call.
   * Returns undefined while loading, [] when no photos exist.
   */
  const photos = useDamagePhotoReportsWithUrls(caseId);

  /**
   * Per-item damage reports joining damaged manifest items with audit events.
   * Re-evaluates whenever a manifest item's status changes to "damaged" or
   * when a damage_reported event is appended to the events table.
   */
  const damageReports = useDamageReportsByCase(caseId);

  /**
   * Inspection summary including all checklist items, inspector metadata,
   * and aggregated progress counts.
   * Re-evaluates whenever the inspection or any manifest item changes.
   */
  const checklistData = useChecklistWithInspection(caseId) as ChecklistWithInspection | undefined;

  // ── Annotation list expansion state ─────────────────────────────────────────

  const [expandedPhotoIds, setExpandedPhotoIds] = useState<Set<string>>(new Set());

  function handleToggleAnnotations(photoId: string) {
    setExpandedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }

  // ── Loading state ────────────────────────────────────────────────────────────

  if (photos === undefined || damageReports === undefined || checklistData === undefined) {
    return (
      <div className={styles.panel} data-testid="evidence-panel-loading">
        <EvidenceSkeleton />
      </div>
    );
  }

  // ── Empty state (no damage evidence at all) ──────────────────────────────────

  const hasEvidence = photos.length > 0 || (damageReports?.length ?? 0) > 0;

  // ── Build lookup: templateItemId → photos ────────────────────────────────────
  // So each damage item card can display its associated photos.

  const photosByTemplateId = new Map<string, DamagePhotoReportWithUrl[]>();
  for (const photo of photos) {
    const key = photo.templateItemId ?? "__case_level__";
    const arr = photosByTemplateId.get(key) ?? [];
    arr.push(photo);
    photosByTemplateId.set(key, arr);
  }

  // Case-level photos (no manifest item link)
  const caseLevelPhotos = photosByTemplateId.get("__case_level__") ?? [];

  return (
    <div
      className={styles.panel}
      data-testid="evidence-panel"
    >
      {/* ── 1. Inspection report header ──────────────────────────── */}
      {checklistData && (
        <>
          <InspectionHeader data={checklistData} />
          <hr className={shared.divider} aria-hidden="true" />
        </>
      )}

      {/* ── 2. Empty state ────────────────────────────────────────── */}
      {!hasEvidence && <EvidenceEmptyState />}

      {/* ── 3. Photo gallery ──────────────────────────────────────── */}
      {photos.length > 0 && (
        <section aria-labelledby="evidence-gallery-heading">
          <div className={shared.sectionHeader}>
            <h2
              id="evidence-gallery-heading"
              className={shared.sectionTitle}
            >
              Photo Evidence
            </h2>
            <span className={shared.timestamp}>
              {photos.length} photo{photos.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div
            className={styles.photoGallery}
            role="list"
            aria-label={`${photos.length} damage photo${photos.length !== 1 ? "s" : ""}`}
          >
            {photos.map((photo) => {
              // Find the item name for this photo's templateItemId
              const itemName = photo.templateItemId
                ? damageReports?.find(
                    (r) => r.templateItemId === photo.templateItemId
                  )?.itemName
                : undefined;

              return (
                <div key={photo.id} role="listitem">
                  <PhotoCard
                    photo={photo}
                    itemName={itemName}
                    annotationsExpanded={expandedPhotoIds.has(photo.id)}
                    onToggleAnnotations={() => handleToggleAnnotations(photo.id)}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 4. Item-level damage cards ─────────────────────────────── */}
      {(damageReports ?? []).length > 0 && (
        <>
          <hr className={shared.divider} aria-hidden="true" />

          <section aria-labelledby="evidence-items-heading">
            <div className={shared.sectionHeader}>
              <h2
                id="evidence-items-heading"
                className={shared.sectionTitle}
              >
                Damaged Items
              </h2>
              <span className={shared.timestamp}>
                {(damageReports ?? []).length} item{(damageReports ?? []).length !== 1 ? "s" : ""}
              </span>
            </div>

            <div
              className={styles.damageItemList}
              role="list"
              aria-label="Damaged manifest items"
            >
              {(damageReports ?? []).map((report) => {
                const itemPhotos = photosByTemplateId.get(report.templateItemId) ?? [];
                return (
                  <div key={report.manifestItemId} role="listitem">
                    <DamageItemCard
                      report={report}
                      photoCount={itemPhotos.length}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* ── 5. Case-level photos note (not linked to specific items) ── */}
      {/*
       * Case-level photos are already displayed in the "Photo Evidence" gallery
       * above (section 3) — we do NOT repeat their cards here to avoid
       * duplication.  We only render the section heading + a brief explanatory
       * note so operators know which photos in the gallery are unlinked.
       */}
      {caseLevelPhotos.length > 0 && (
        <>
          <hr className={shared.divider} aria-hidden="true" />

          <section aria-labelledby="evidence-case-photos-heading">
            <div className={shared.sectionHeader}>
              <h2
                id="evidence-case-photos-heading"
                className={shared.sectionTitle}
              >
                Case-Level Photos
              </h2>
              <span className={shared.timestamp}>
                Not linked to a specific item
              </span>
            </div>
            <p className={styles.photoCountNote}>
              {caseLevelPhotos.length} photo{caseLevelPhotos.length !== 1 ? "s" : ""} in the gallery above{" "}
              {caseLevelPhotos.length === 1 ? "is" : "are"} not linked to a specific manifest item.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

export default DossierEvidencePanel;
