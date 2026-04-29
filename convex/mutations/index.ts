/**
 * convex/mutations/index.ts
 *
 * Barrel re-export for all canonical SCAN app mutation functions.
 *
 * This index allows callers to import from the parent module namespace
 * instead of individual files:
 *
 *   // All scan mutations:
 *   import { checkInCase, logScanOnly } from "../mutations/scan";
 *
 *   // All checklist mutations:
 *   import { updateChecklistItem, markItemDamaged, submitInspection } from "../mutations/checklist";
 *
 *   // All damage report mutations:
 *   import { submitDamageReport, bulkSubmitDamageReports } from "../mutations/damage";
 *
 *   // All custody handoff mutations:
 *   import { handoffCustody } from "../mutations/custody";
 *
 *   // All ship action mutations:
 *   import { recordShipment } from "../mutations/ship";
 *
 * Convex API surface
 * ──────────────────
 * Because Convex generates its API from file paths, each mutation is
 * accessible via the generated `api` object using its file path:
 *
 *   api.mutations.scan.checkInCase
 *   api.mutations.scan.logScanOnly
 *   api.mutations.checklist.updateChecklistItem
 *   api.mutations.checklist.markItemOk
 *   api.mutations.checklist.markItemDamaged
 *   api.mutations.checklist.markItemMissing
 *   api.mutations.checklist.resetChecklistItem
 *   api.mutations.checklist.submitInspection      ← Sub-AC 350102/2 batch inspect action
 *   api.mutations.damage.generateDamagePhotoUploadUrl
 *   api.mutations.damage.generateMultipleUploadUrls
 *   api.mutations.damage.submitDamageReport
 *   api.mutations.damage.bulkSubmitDamageReports
 *   api.mutations.damage.resolveDamageReport
 *   api.mutations.custody.generateSignatureUploadUrl
 *   api.mutations.custody.handoffCustody
 *   api.mutations.ship.recordShipment             ← Sub-AC 350104/4 ship action
 *
 * TypeScript types
 * ────────────────
 * Return type interfaces are exported from each sub-module and re-exported here
 * so callers can import them from a single location:
 *
 *   import type {
 *     CheckInCaseResult,
 *     LogScanOnlyResult,
 *     UpdateChecklistItemResult,
 *     InspectionCounters,
 *     InspectItemResult,
 *     SubmittedInspectionItemResult,
 *     SubmitInspectionResult,
 *     DamageReportResult,
 *     BulkDamageReportResult,
 *     ResolveDamageReportResult,
 *     HandoffCustodyResult,
 *     RecordShipmentResult,
 *   } from "@/convex/mutations";
 */

// ── Scan mutation result types ────────────────────────────────────────────────
export type { CheckInCaseResult, LogScanOnlyResult } from "./scan";

// ── Checklist mutation result types ──────────────────────────────────────────
export type {
  UpdateChecklistItemResult,
  InspectionCounters,
  InspectItemResult,
  SubmittedInspectionItemResult,
  SubmitInspectionResult,
} from "./checklist";

// ── Damage report mutation result types ──────────────────────────────────────
export type {
  DamageReportResult,
  BulkDamageReportResult,
  ResolveDamageReportResult,
} from "./damage";

// ── Custody handoff mutation result types ─────────────────────────────────────
export type { HandoffCustodyResult } from "./custody";

// ── Ship action mutation result types ─────────────────────────────────────────
export type { RecordShipmentResult } from "./ship";
