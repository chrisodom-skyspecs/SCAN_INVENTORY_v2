/**
 * src/hooks/use-scan-mutations.ts
 *
 * Convex `useMutation` hooks for the SCAN mobile app write operations.
 *
 * Architecture
 * ────────────
 * Each hook wraps a public mutation from convex/scan.ts via `useMutation`
 * (from convex/react).  Calling the returned function sends the mutation to
 * the Convex backend and returns a Promise that resolves to the typed result.
 *
 * Real-time fidelity (≤ 2 seconds)
 * ──────────────────────────────────
 * Every mutation in convex/scan.ts writes to the `cases` or `manifestItems` /
 * `inspections` tables.  Convex automatically re-evaluates all subscribed
 * queries that read those tables and pushes the diff to connected clients
 * within ~100–300 ms.  The INVENTORY dashboard's M1–M5 map views subscribe
 * to those queries — meaning a SCAN app mutation is reflected on the dashboard
 * map within the 2-second window without any polling or manual refetch.
 *
 * Field shape alignment with M1–M5 map queries
 * ─────────────────────────────────────────────
 * The mutations accept arguments that map directly to the filter fields used
 * by the INVENTORY dashboard map queries (see convex/maps.ts):
 *
 *   technicianId  → cases.assigneeId  (M1/M3 assigneeId filter)
 *   status        → cases.status      (M1/M2/M3 status filter, M5 weight)
 *   timestamp     → cases.updatedAt   (M1 by_updated sort index)
 *   lat / lng     → cases.lat / .lng  (all modes withinBounds check)
 *
 * Available hooks:
 *   useScanCheckIn()          — QR scan: update case status + position
 *   useUpdateChecklistItem()  — mark manifest item ok/damaged/missing
 *   useStartInspection()      — open a fresh inspection pass
 *   useCompleteInspection()   — close an inspection after all items reviewed
 *
 * Error handling
 * ──────────────
 * Convex surfaces mutation errors as rejected Promises.  The SCAN app should
 * wrap calls in try/catch and display user-friendly messages.  Common errors:
 *   • "Case X not found."         — invalid or deleted caseId
 *   • "Invalid status transition" — attempted transition not in VALID_TRANSITIONS
 *   • "Manifest item X not found" — templateItemId not on this case
 *   • "Inspection already completed" — calling completeInspection twice
 */

"use client";

import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

// Re-export result types so consumers can import them from the hook module.
export type {
  ScanCheckInResult,
  UpdateChecklistItemResult,
  InspectionResult,
} from "../../convex/scan";

export type { ShipCaseResult } from "../../convex/shipping";

export type { HandoffCustodyResult } from "../../convex/custody";

// ─── useScanCheckIn ───────────────────────────────────────────────────────────

/**
 * Returns a mutation function for the QR scan check-in action.
 *
 * The mutation updates the case's status, assignee, and optional GPS position
 * — the exact fields the M1–M5 dashboard map queries filter and sort on.
 * When transitioning a case to "in_field", it also creates a new inspection
 * record whose counters feed M3's per-pin progress bars.
 *
 * Usage:
 *   const checkIn = useScanCheckIn();
 *
 *   // After QR decode + case lookup:
 *   try {
 *     const result = await checkIn({
 *       caseId:         resolvedCase._id,
 *       status:         "in_field",       // ← cases.status (M1/M2/M3 filter)
 *       timestamp:      Date.now(),       // ← cases.updatedAt (M1 sort)
 *       technicianId:   kindeUser.id,     // ← cases.assigneeId (M1/M3 filter)
 *       technicianName: "Jane Pilot",     // ← cases.assigneeName (display)
 *       lat:            position.coords.latitude,   // ← cases.lat (M1-M5 bounds)
 *       lng:            position.coords.longitude,  // ← cases.lng
 *       locationName:   "Site Alpha",
 *     });
 *     console.log("Inspection created:", result.inspectionId);
 *   } catch (err) {
 *     // Handle invalid transition, case not found, etc.
 *   }
 *
 * Returns:
 *   ScanCheckInResult { caseId, previousStatus, newStatus, inspectionId? }
 */
export function useScanCheckIn() {
  return useMutation(api.scan.scanCheckIn);
}

// ─── useUpdateChecklistItem ───────────────────────────────────────────────────

/**
 * Returns a mutation function for updating a single manifest item's inspection
 * state during a field inspection.
 *
 * After updating the item, the mutation re-syncs the active inspection's
 * aggregate counters (checkedItems, damagedItems, missingItems, totalItems) —
 * the exact counters M3 (Field Mode) uses for per-pin progress bars and the
 * summary panel counts.
 *
 * Usage:
 *   const updateItem = useUpdateChecklistItem();
 *
 *   // Technician taps "OK" on a checklist item:
 *   await updateItem({
 *     caseId:         caseDoc._id,
 *     templateItemId: "item-battery-pack",  // stable ID from template
 *     status:         "ok",                 // ← manifestItems.status
 *     timestamp:      Date.now(),           // ← checkedAt + event.timestamp
 *     technicianId:   kindeUser.id,         // ← checkedById
 *     technicianName: "Jane Pilot",
 *   });
 *
 *   // Technician reports damage with photo:
 *   await updateItem({
 *     caseId:            caseDoc._id,
 *     templateItemId:    "item-drone-body",
 *     status:            "damaged",
 *     timestamp:         Date.now(),
 *     technicianId:      kindeUser.id,
 *     technicianName:    "Jane Pilot",
 *     notes:             "Cracked housing on B-side",
 *     photoStorageIds:   ["storage_abc123"],
 *     damageDescription: "Impact crack visible on battery housing",
 *     damageSeverity:    "moderate",
 *   });
 *
 * Returns:
 *   UpdateChecklistItemResult {
 *     itemId, previousStatus, newStatus,
 *     inspectionCounters: { totalItems, checkedItems, damagedItems, missingItems }
 *   }
 */
export function useUpdateChecklistItem() {
  return useMutation(api.scan.updateChecklistItem);
}

// ─── useStartInspection ───────────────────────────────────────────────────────

/**
 * Returns a mutation function for explicitly starting a new inspection.
 *
 * Normally, inspections are created automatically by useScanCheckIn when a
 * case transitions to "in_field".  Use this hook when:
 *   • The case is already "in_field" and needs a fresh inspection pass.
 *   • The technician wants to re-inspect after previously completing one.
 *
 * The created inspection record is immediately visible in M3 (Field Mode)
 * map pins via Convex's reactive subscription to the inspections table.
 *
 * Usage:
 *   const startInsp = useStartInspection();
 *
 *   const { inspectionId } = await startInsp({
 *     caseId:         caseDoc._id,
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *   });
 *
 * Returns:
 *   InspectionResult { inspectionId, caseId, status: "in_progress" }
 */
export function useStartInspection() {
  return useMutation(api.scan.startInspection);
}

// ─── useCompleteInspection ────────────────────────────────────────────────────

/**
 * Returns a mutation function for completing an active inspection.
 *
 * Call this when ChecklistSummary.isComplete === true (all items reviewed)
 * and the technician taps the "Complete Inspection" button in the SCAN app.
 *
 * The inspection status is set to "completed" when all items are ok/missing-free,
 * or "flagged" when any items are damaged or missing — "flagged" status surfaces
 * in M3's byInspectionStatus summary, alerting the dashboard team to review.
 *
 * Also touches cases.updatedAt so the M1 by_updated index reflects this as
 * recent activity.
 *
 * Usage:
 *   const completeInsp = useCompleteInspection();
 *
 *   // After summary.isComplete === true:
 *   const { status } = await completeInsp({
 *     inspectionId:   inspection._id,
 *     caseId:         caseDoc._id,
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *   });
 *   // status: "completed" | "flagged"
 *
 * Returns:
 *   InspectionResult { inspectionId, caseId, status: "completed" | "flagged" }
 */
export function useCompleteInspection() {
  return useMutation(api.scan.completeInspection);
}

// ─── useShipCase ──────────────────────────────────────────────────────────────

/**
 * Returns a mutation function for the SCAN app FedEx ship action.
 *
 * This is the primary mutation called when a field technician or pilot enters a
 * FedEx tracking number and confirms the shipment in the SCAN mobile app.
 *
 * What this mutation writes (and why it matters for the dashboard):
 * ┌─────────────────────────────┬──────────────────────────────────────────────┐
 * │ Field written               │ Dashboard query effect                       │
 * ├─────────────────────────────┼──────────────────────────────────────────────┤
 * │ cases.status = "shipping"   │ M1 status pill updates; M4 in-transit filter │
 * │                             │ (listCases?status=shipping re-evaluates)     │
 * │ cases.trackingNumber        │ T3 getCaseShippingLayout tracking badge      │
 * │ cases.carrier               │ T3 carrier chip ("FedEx")                    │
 * │ cases.shippedAt             │ T3 "Shipped N days ago" relative timestamp   │
 * │ cases.destinationName       │ T3 destination chip; M4 tooltip              │
 * │ cases.destinationLat/Lng    │ M4 assembleM4 destination pin fallback       │
 * │ cases.updatedAt             │ M1 by_updated sort index ("N min ago")       │
 * │ shipments (new row)         │ listShipmentsByCase re-evaluates; M4 map pin │
 * │ events "shipped" (appended) │ T5 audit timeline "Shipped" milestone        │
 * └─────────────────────────────┴──────────────────────────────────────────────┘
 *
 * Real-time fidelity:
 *   Convex re-evaluates all subscribed queries that read the touched rows
 *   within ~100–300 ms — including getCaseShippingLayout (T3 layout),
 *   listShipmentsByCase (T3/T4 detail panels), getCaseStatus (map pins),
 *   and listCases (fleet overview) — satisfying the ≤ 2-second requirement.
 *
 * Usage (SCAN app "Ship Case" screen):
 *   const shipCase = useShipCase();
 *
 *   // User enters tracking number and taps "Confirm Shipment":
 *   try {
 *     const result = await shipCase({
 *       caseId:          resolvedCase._id,    // from QR scan
 *       trackingNumber:  "794644823741",      // entered by technician
 *       userId:          kindeUser.id,
 *       userName:        "Jane Pilot",
 *       originName:      "Site Alpha",
 *       originLat:       position.coords.latitude,
 *       originLng:       position.coords.longitude,
 *       destinationName: "SkySpecs HQ — Ann Arbor",
 *     });
 *     // result.caseId         → the shipped case ID
 *     // result.shipmentId     → new Convex shipments row ID
 *     // result.trackingNumber → "794644823741" (trimmed)
 *     // result.carrier        → "FedEx"
 *     // result.shippedAt      → epoch ms
 *     // result.previousStatus → "in_field" (or wherever it came from)
 *   } catch (err) {
 *     // "Case X not found."
 *     // "trackingNumber must be a non-empty string."
 *     // "Cannot ship case in status 'shipping'."
 *   }
 *
 * Returns:
 *   ShipCaseResult {
 *     caseId, shipmentId, trackingNumber, carrier, shippedAt, previousStatus
 *   }
 */
export function useShipCase() {
  return useMutation(api.shipping.shipCase);
}

// ─── useHandoffCustody ────────────────────────────────────────────────────────

/**
 * Returns a mutation function for the SCAN app custody handoff action.
 *
 * This is the primary mutation called when a field technician or pilot
 * transfers custody of a case to another person in the SCAN mobile app.
 *
 * What this mutation writes (and why it matters for the dashboard):
 * ┌─────────────────────────────────┬──────────────────────────────────────────┐
 * │ Field / table written           │ Dashboard subscription effect            │
 * ├─────────────────────────────────┼──────────────────────────────────────────┤
 * │ custodyRecords (new row)        │ getCustodyRecordsByCase, getLatestCustody │
 * │                                 │ getCustodyChain → T2/T5 panels update    │
 * │ cases.assigneeId                │ M2 assignment map re-evaluates;          │
 * │                                 │ M1/M3 assigneeId filter re-evaluates     │
 * │ cases.assigneeName              │ M2 case pin tooltip shows new custodian  │
 * │ cases.updatedAt                 │ M1 by_updated sort index ("N min ago")   │
 * │ cases.lat / .lng (optional)     │ All modes withinBounds() check           │
 * │ cases.locationName (optional)   │ Map pin location label                   │
 * │ events "custody_handoff" row    │ T5 immutable audit timeline milestone    │
 * │ notifications row               │ In-app alert to incoming custodian       │
 * └─────────────────────────────────┴──────────────────────────────────────────┘
 *
 * Convex re-evaluates all subscribed queries that read the touched rows
 * within ~100–300 ms, satisfying the ≤ 2-second real-time fidelity requirement
 * between the SCAN app handoff action and INVENTORY dashboard visibility.
 *
 * Subscription invalidation triggered by this mutation:
 *   • getCustodyRecordsByCase / getLatestCustodyRecord  (custodyRecords read)
 *   • getCustodyChain                                   (custodyRecords read)
 *   • getCustodyRecordsByCustodian(toUserId)            (by_to_user index)
 *   • getCustodyRecordsByTransferrer(fromUserId)        (by_from_user index)
 *   • getCustodianIdentitySummary                       (both index reads)
 *   • getCaseById / listCases / getCasesInBounds        (cases row patched)
 *   • getCaseStatusCounts                               (cases row patched)
 *   • M2 getM2MissionMode                               (cases.assigneeId)
 *
 * Usage (SCAN app custody handoff confirmation screen):
 *   const handoff = useHandoffCustody();
 *
 *   try {
 *     const result = await handoff({
 *       caseId:       resolvedCase._id,
 *       fromUserId:   currentUser.id,
 *       fromUserName: currentUser.fullName,
 *       toUserId:     recipientUserId,
 *       toUserName:   recipientUserName,
 *       handoffAt:    Date.now(),
 *       lat:          position.coords.latitude,
 *       lng:          position.coords.longitude,
 *       locationName: "Site Alpha — Turbine Row 3",
 *       notes:        "All items verified, case intact",
 *     });
 *     // result.custodyRecordId → new custodyRecords row
 *     // result.eventId         → new events row (custody_handoff)
 *   } catch (err) {
 *     // "Case X not found."
 *   }
 *
 * Returns:
 *   HandoffCustodyResult {
 *     custodyRecordId, caseId, fromUserId, toUserId, handoffAt, eventId
 *   }
 */
export function useHandoffCustody() {
  return useMutation(api.custody.handoffCustody);
}
