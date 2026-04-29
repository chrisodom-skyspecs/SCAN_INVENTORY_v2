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
 * Optimistic Updates (Sub-AC 2b)
 * ──────────────────────────────
 * Every mutation hook in this file uses `.withOptimisticUpdate()` to apply
 * immediate local state changes before the server round-trip completes.
 *
 * The optimistic update runs synchronously when the mutation function is called.
 * If the server mutation succeeds, Convex replaces the optimistic state with the
 * authoritative server value.  If it fails, Convex automatically rolls back the
 * optimistic update — no cleanup code needed in the component.
 *
 * Queries patched optimistically per action:
 *
 *   useScanCheckIn
 *     • api.cases.getCaseById        — status, assigneeId, assigneeName, updatedAt, lat, lng
 *     • api.cases.getCaseStatus      — same lightweight projection fields
 *
 *   useUpdateChecklistItem
 *     • api.checklists.getChecklistByCase       — item status, checkedAt, checkedBy*
 *     • api.checklists.getChecklistWithInspection — items + recomputed summary
 *
 *   useShipCase
 *     • api.cases.getCaseById        — status (transit_out|transit_in), trackingNumber,
 *                                      carrier, shippedAt, destinationName, updatedAt
 *     • api.shipping.listShipmentsByCase — prepend an optimistic shipment row
 *
 *   useHandoffCustody
 *     • api.cases.getCaseById        — assigneeId, assigneeName, updatedAt, lat, lng
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
 * The optimistic updates make the SCAN app itself feel instant — the UI
 * reflects the mutation result before the server round-trip completes.
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
 *   useShipCase()             — FedEx ship action: create shipment + update case
 *   useHandoffCustody()       — transfer custody of a case to another user
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
import { buildSummary } from "../../convex/checklistHelpers";
import type { Id } from "../../convex/_generated/dataModel";

// Re-export result types so consumers can import them from the hook module.
export type {
  ScanCheckInResult,
  UpdateChecklistItemResult,
  InspectionResult,
} from "../../convex/scan";

// Re-export canonical mutations/scan result types
export type {
  CheckInCaseResult,
  LogScanOnlyResult,
} from "../../convex/mutations/scan";

export type { ShipCaseResult } from "../../convex/shipping";

export type { HandoffCustodyResult } from "../../convex/custodyHandoffs";

export type {
  AssociateQRCodeResult,
  QrCodeValidationResult,
} from "../../convex/qrCodes";

// ─── useScanCheckIn ───────────────────────────────────────────────────────────

/**
 * Returns a mutation function for the QR scan check-in action.
 *
 * Optimistic update (Sub-AC 2b):
 *   Immediately reflects the new case status, assignee, and position in
 *   api.cases.getCaseById and api.cases.getCaseStatus before the server
 *   round-trip completes.  Convex rolls back automatically if the mutation
 *   fails.
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
  return useMutation(api.scan.scanCheckIn).withOptimisticUpdate(
    (localStore, args) => {
      // ── Optimistically update getCaseById ──────────────────────────────────
      // getCaseById is the primary subscription for the check-in screen header
      // and the case detail page.  Updating it immediately removes the latency
      // between "Confirm Check-In" tap and the UI reflecting the new status.
      const caseDoc = localStore.getQuery(api.cases.getCaseById, {
        caseId: args.caseId,
      });
      if (caseDoc) {
        localStore.setQuery(
          api.cases.getCaseById,
          { caseId: args.caseId },
          {
            ...caseDoc,
            status:       args.status,
            assigneeId:   args.technicianId,
            assigneeName: args.technicianName,
            updatedAt:    args.timestamp,
            // Only override optional geo fields when provided in args
            ...(args.lat  !== undefined ? { lat:          args.lat          } : {}),
            ...(args.lng  !== undefined ? { lng:          args.lng          } : {}),
            ...(args.locationName !== undefined
              ? { locationName: args.locationName }
              : {}),
          }
        );
      }

      // ── Optimistically update getCaseStatus ────────────────────────────────
      // getCaseStatus is a lightweight projection used by status badges and
      // the success screen.  Keeping it in sync avoids a loading flash between
      // the optimistic update and the server confirmation.
      const caseStatus = localStore.getQuery(api.cases.getCaseStatus, {
        caseId: args.caseId,
      });
      if (caseStatus) {
        localStore.setQuery(
          api.cases.getCaseStatus,
          { caseId: args.caseId },
          {
            ...caseStatus,
            status:       args.status,
            assigneeId:   args.technicianId,
            assigneeName: args.technicianName,
            updatedAt:    args.timestamp,
            ...(args.lat  !== undefined ? { lat:          args.lat          } : {}),
            ...(args.lng  !== undefined ? { lng:          args.lng          } : {}),
            ...(args.locationName !== undefined
              ? { locationName: args.locationName }
              : {}),
          }
        );
      }
    }
  );
}

// ─── useUpdateChecklistItem ───────────────────────────────────────────────────

/**
 * Returns a mutation function for updating a single manifest item's inspection
 * state during a field inspection.
 *
 * Optimistic update (Sub-AC 2b):
 *   Immediately reflects the item status change in:
 *     • api.checklists.getChecklistByCase       — item list visible in checklist
 *     • api.checklists.getChecklistWithInspection — items + recomputed summary
 *
 *   The progress bar, "ok/damaged/missing" counts, and the "Complete Inspection"
 *   CTA enable state all update instantly without waiting for the server.
 *   Convex rolls back if the mutation fails.
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
 * Returns:
 *   UpdateChecklistItemResult {
 *     itemId, previousStatus, newStatus,
 *     inspectionCounters: { totalItems, checkedItems, damagedItems, missingItems }
 *   }
 */
export function useUpdateChecklistItem() {
  return useMutation(api.scan.updateChecklistItem).withOptimisticUpdate(
    (localStore, args) => {
      const { caseId, templateItemId, status, timestamp, technicianId, technicianName, notes } = args;

      /**
       * Apply the item status change to a ChecklistItem array.
       * Returns a new array — does not mutate in place.
       */
      const applyItemUpdate = <T extends {
        templateItemId: string;
        status: string;
        checkedAt?: number;
        checkedById?: string;
        checkedByName?: string;
        notes?: string;
      }>(items: T[]): T[] =>
        items.map((item) =>
          item.templateItemId === templateItemId
            ? {
                ...item,
                status,
                checkedAt:    timestamp,
                checkedById:  technicianId,
                checkedByName: technicianName,
                // Only include notes when provided — avoid overwriting existing
                // notes with undefined when the technician didn't add any.
                ...(notes !== undefined ? { notes } : {}),
              }
            : item
        );

      // ── Optimistically update getChecklistByCase ───────────────────────────
      // Primary data source for the checklist item list.  Each row is a
      // ChecklistItem with status, checkedAt, checkedBy*, and notes.
      const checklistItems = localStore.getQuery(
        api.checklists.getChecklistByCase,
        { caseId }
      );
      if (checklistItems !== undefined) {
        localStore.setQuery(
          api.checklists.getChecklistByCase,
          { caseId },
          applyItemUpdate(checklistItems)
        );
      }

      // ── Optimistically update getChecklistWithInspection ──────────────────
      // Combined subscription used by ScanInspectClient.  Includes items,
      // inspection metadata, and the computed summary (progressPct, isComplete,
      // ok/damaged/missing/unchecked counts).
      //
      // We re-run buildSummary on the optimistically updated item list so the
      // progress bar and "Complete Inspection" CTA gate update instantly.
      const checklistWithInsp = localStore.getQuery(
        api.checklists.getChecklistWithInspection,
        { caseId }
      );
      if (checklistWithInsp !== undefined) {
        const updatedItems   = applyItemUpdate(checklistWithInsp.items);
        const updatedSummary = buildSummary(caseId.toString(), updatedItems);
        localStore.setQuery(
          api.checklists.getChecklistWithInspection,
          { caseId },
          {
            ...checklistWithInsp,
            items:   updatedItems,
            summary: updatedSummary,
          }
        );
      }
    }
  );
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
 * No optimistic update is applied here because creating an inspection has
 * no immediate local state to pre-fill — the inspection record requires a
 * server-assigned ID that isn't available until the mutation completes.
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
 * No optimistic update is applied here because the "completed" vs "flagged"
 * outcome depends on the server-side item aggregation — the client cannot
 * reliably determine this without re-running the same logic.  The mutation
 * completes quickly (~100–200 ms) and the success view renders immediately
 * after the Promise resolves.
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
 * Optimistic update (Sub-AC 2b):
 *   Immediately reflects the shipment in two places:
 *
 *   1. api.cases.getCaseById — transitions status to "transit_out" or
 *      "transit_in" (matching server logic) and writes trackingNumber,
 *      carrier, shippedAt, destinationName, and updatedAt.
 *      This makes the case header status pill change instantly.
 *
 *   2. api.shipping.listShipmentsByCase — prepends an optimistic shipment
 *      record so the tracking section appears immediately after the user
 *      taps "Record Shipment", before Convex confirms the write.
 *      The optimistic record uses a temporary ID that Convex replaces with
 *      the authoritative server ID on confirmation.
 *
 *   Convex rolls back both updates automatically if the mutation fails.
 *
 * This is the primary mutation called when a field technician or pilot enters a
 * FedEx tracking number and confirms the shipment in the SCAN mobile app.
 *
 * What this mutation writes (and why it matters for the dashboard):
 * ┌─────────────────────────────┬──────────────────────────────────────────────┐
 * │ Field written               │ Dashboard query effect                       │
 * ├─────────────────────────────┼──────────────────────────────────────────────┤
 * │ cases.status = "transit_*"  │ M1 status pill updates; M4 in-transit filter │
 * │ cases.trackingNumber        │ T3 getCaseShippingLayout tracking badge      │
 * │ cases.carrier               │ T3 carrier chip ("FedEx")                    │
 * │ cases.shippedAt             │ T3 "Shipped N days ago" relative timestamp   │
 * │ cases.destinationName       │ T3 destination chip; M4 tooltip              │
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
  return useMutation(api.shipping.shipCase).withOptimisticUpdate(
    (localStore, args) => {
      const now     = Date.now();
      const tn      = args.trackingNumber.trim();
      const carrier = args.carrier ?? "FedEx";

      // ── Optimistically update getCaseById ──────────────────────────────────
      // Mirrors the server-side logic in convex/shipping.ts:
      //   outboundShippable statuses → "transit_out"
      //   inboundShippable statuses  → "transit_in"
      const caseDoc = localStore.getQuery(api.cases.getCaseById, {
        caseId: args.caseId,
      });
      if (caseDoc) {
        const outboundStatuses = ["hangar", "assembled", "received"];
        const transitStatus = outboundStatuses.includes(caseDoc.status)
          ? ("transit_out" as const)
          : ("transit_in" as const);

        localStore.setQuery(
          api.cases.getCaseById,
          { caseId: args.caseId },
          {
            ...caseDoc,
            status:         transitStatus,
            trackingNumber: tn,
            carrier,
            shippedAt:      now,
            updatedAt:      now,
            ...(args.destinationName !== undefined
              ? { destinationName: args.destinationName }
              : {}),
            ...(args.destinationLat !== undefined
              ? { destinationLat: args.destinationLat }
              : {}),
            ...(args.destinationLng !== undefined
              ? { destinationLng: args.destinationLng }
              : {}),
          }
        );
      }

      // ── Optimistically update listShipmentsByCase ──────────────────────────
      // Prepend an optimistic shipment so hasTracking flips to true immediately
      // and the tracking status section renders without waiting for the server.
      // The temporary ID is replaced with the authoritative server ID when
      // Convex confirms the write (~100–300 ms later).
      const currentShipments = localStore.getQuery(
        api.shipping.listShipmentsByCase,
        { caseId: args.caseId }
      );
      if (currentShipments !== undefined) {
        // Use a type cast for the optimistic record because the server assigns
        // the real Convex ID (_id) — we generate a temporary placeholder here
        // that Convex replaces on confirmation.  eslint-disable-next-line
        // is intentional: this is a safe optimistic-only cast.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const optimisticShipment: any = {
          _id:            `optimistic_${now}` as unknown as Id<"shipments">,
          _creationTime:  now,
          caseId:         args.caseId,
          trackingNumber: tn,
          carrier,
          status:         "label_created" as const,
          originName:     args.originName,
          originLat:      args.originLat,
          originLng:      args.originLng,
          destinationName: args.destinationName,
          destinationLat: args.destinationLat,
          destinationLng: args.destinationLng,
          shippedAt:      now,
          createdAt:      now,
          updatedAt:      now,
        };

        localStore.setQuery(
          api.shipping.listShipmentsByCase,
          { caseId: args.caseId },
          // Newest first — matches the server ORDER BY createdAt DESC
          [optimisticShipment, ...currentShipments]
        );
      }
    }
  );
}

// ─── useHandoffCustody ────────────────────────────────────────────────────────

/**
 * Returns a mutation function for the SCAN app custody handoff action.
 *
 * Optimistic update (Sub-AC 2b):
 *   Immediately reflects the new assignee in api.cases.getCaseById so the
 *   "Current Custodian" section and the case detail header update instantly
 *   after the technician taps "Confirm Transfer".
 *   Convex rolls back automatically if the mutation fails.
 *
 * This is the primary mutation called when a field technician or pilot
 * transfers custody of a case to another person in the SCAN mobile app.
 *
 * What this mutation writes (and why it matters for the dashboard):
 * ┌─────────────────────────────────┬──────────────────────────────────────────┐
 * │ Field / table written           │ Dashboard subscription effect            │
 * ├─────────────────────────────────┼──────────────────────────────────────────┤
 * │ custodyRecords (new row)        │ getCustodyRecordsByCase, getLatestCustody │
 * │ cases.assigneeId                │ M2 assignment map re-evaluates;          │
 * │ cases.assigneeName              │ M2 case pin tooltip shows new custodian  │
 * │ cases.updatedAt                 │ M1 by_updated sort index ("N min ago")   │
 * │ cases.lat / .lng (optional)     │ All modes withinBounds() check           │
 * │ events "custody_handoff" row    │ T5 immutable audit timeline milestone    │
 * │ notifications row               │ In-app alert to incoming custodian       │
 * └─────────────────────────────────┴──────────────────────────────────────────┘
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
  return useMutation(api.custodyHandoffs.handoffCustody).withOptimisticUpdate(
    (localStore, args) => {
      // ── Optimistically update getCaseById ──────────────────────────────────
      // Immediately reflect the new custodian in the case detail header and
      // the "Current Custodian" section of the handoff form.
      const caseDoc = localStore.getQuery(api.cases.getCaseById, {
        caseId: args.caseId,
      });
      if (caseDoc) {
        localStore.setQuery(
          api.cases.getCaseById,
          { caseId: args.caseId },
          {
            ...caseDoc,
            assigneeId:   args.toUserId,
            assigneeName: args.toUserName,
            updatedAt:    args.handoffAt,
            // Only override optional geo fields when provided in args
            ...(args.lat  !== undefined ? { lat:          args.lat          } : {}),
            ...(args.lng  !== undefined ? { lng:          args.lng          } : {}),
            ...(args.locationName !== undefined
              ? { locationName: args.locationName }
              : {}),
          }
        );
      }
    }
  );
}

// ─── useAssociateQRCode ───────────────────────────────────────────────────────

/**
 * Returns a mutation function for associating a QR code payload with an
 * equipment case.
 *
 * Optimistic update:
 *   Immediately reflects the new QR code in api.cases.getCaseById so the
 *   case detail header (which displays the current QR association) updates
 *   before the Convex round-trip completes.  Convex rolls back automatically
 *   if the mutation fails (e.g., uniqueness conflict).
 *
 * Validation (server-side, enforced by the Convex mutation):
 *   • qrCode must be a non-empty, non-whitespace string.
 *   • The target case must exist (valid Convex document ID).
 *   • The QR code must not already be mapped to a different case.
 *     (Mapping to the same case is an idempotent no-op — returns wasAlreadyMapped: true.)
 *
 * Client validation (pre-flight, via validateQrCode query):
 *   Use `useQuery(api.qrCodes.validateQrCode, { qrCode, caseId })` in the
 *   confirm step to show the user a ConflictBanner before calling this mutation.
 *   validateQrCode subscribes reactively, so it re-evaluates if another client
 *   maps the same QR code between capture and confirmation.
 *
 * What this mutation writes (and dashboard effect):
 * ┌──────────────────────┬──────────────────────────────────────────────────┐
 * │ Field / table        │ Dashboard subscription effect                    │
 * ├──────────────────────┼──────────────────────────────────────────────────┤
 * │ cases.qrCode         │ getCaseByQrCode, getCaseById re-evaluate         │
 * │ cases.updatedAt      │ M1 by_updated sort index ("just now")            │
 * │ events "note_added"  │ T5 audit timeline "QR code associated" milestone │
 * └──────────────────────┴──────────────────────────────────────────────────┘
 *
 * Usage (SCAN app associate screen):
 *   const associateQR = useAssociateQRCode();
 *
 *   // After user confirms on the confirm step:
 *   try {
 *     const result = await associateQR({
 *       qrCode:   "https://scan.skyspecs.com/case/case123?uid=4f3d1a9b2c7e5f0a",
 *       caseId:   targetCase._id,
 *       userId:   kindeUser.id,
 *       userName: "Jane Pilot",
 *     });
 *     // result.wasAlreadyMapped → true when QR was already on this case (no DB write)
 *     // result.wasAlreadyMapped → false when the QR was newly associated
 *   } catch (err) {
 *     // "qrCode must be a non-empty string."
 *     // "Case 'X' not found."
 *     // "QR code is already mapped to case 'Y' (ID: Z)."
 *   }
 *
 * Returns:
 *   AssociateQRCodeResult { caseId, qrCode, wasAlreadyMapped }
 */
export function useAssociateQRCode() {
  return useMutation(api.qrCodes.associateQRCodeToCase).withOptimisticUpdate(
    (localStore, args) => {
      // ── Optimistically update getCaseById ──────────────────────────────────
      // Immediately reflect the new qrCode on the case document so any
      // component subscribed to getCaseById (e.g., the associate screen header,
      // the case detail page) shows the updated QR label before the server
      // confirms the write.  Convex rolls back this optimistic value if the
      // mutation rejects (e.g., uniqueness conflict caught server-side).
      const caseDoc = localStore.getQuery(api.cases.getCaseById, {
        caseId: args.caseId,
      });
      if (caseDoc) {
        localStore.setQuery(
          api.cases.getCaseById,
          { caseId: args.caseId },
          {
            ...caseDoc,
            // Trim to match the server-side normalisation in associateQRCodeToCase.
            qrCode:    args.qrCode.trim(),
            updatedAt: Date.now(),
          }
        );
      }
    }
  );
}

// ─── useCheckInCase ───────────────────────────────────────────────────────────

/**
 * Returns the canonical atomic check-in mutation from convex/mutations/scan.ts.
 *
 * `checkInCase` is the authoritative, atomic QR scan check-in operation.
 * A single call writes to ALL relevant tables in one Convex transaction:
 *   • cases       — PATCH status, assignee, lat/lng, updatedAt
 *   • scans       — INSERT scan log row (caseId, scannedBy, timestamp, location)
 *   • inspections — INSERT new inspection when transitioning to "deployed"
 *   • events      — INSERT status_change + inspection_started audit events
 *
 * Prefer this over useScanCheckIn when:
 *   • You need the scanId in the return value to link to follow-up queries.
 *   • You want the full atomic guarantee (all 4 tables or none).
 *   • You are writing new SCAN app screens and don't need backward compat.
 *
 * Real-time invalidation:
 *   Invalidates getCaseById, getCaseStatus, listCases (map), getScansByCase,
 *   getLastScanForCase, getRecentScans, getChecklistWithInspection within
 *   ~100–300 ms — satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Returns:
 *   CheckInCaseResult {
 *     scanId, caseId, previousStatus, newStatus, scannedAt, inspectionId?
 *   }
 */
export function useCheckInCase() {
  return useMutation(api.mutations.scan.checkInCase).withOptimisticUpdate(
    (localStore, args) => {
      // Optimistically update getCaseById — same fields as useScanCheckIn.
      const caseDoc = localStore.getQuery(api.cases.getCaseById, {
        caseId: args.caseId,
      });
      if (caseDoc) {
        localStore.setQuery(
          api.cases.getCaseById,
          { caseId: args.caseId },
          {
            ...caseDoc,
            status:       args.newStatus,
            assigneeId:   args.technicianId,
            assigneeName: args.technicianName,
            updatedAt:    args.timestamp,
            ...(args.lat          !== undefined ? { lat:          args.lat          } : {}),
            ...(args.lng          !== undefined ? { lng:          args.lng          } : {}),
            ...(args.locationName !== undefined ? { locationName: args.locationName } : {}),
          }
        );
      }
    }
  );
}

// ─── useLogScanOnly ───────────────────────────────────────────────────────────

/**
 * Returns the lightweight scan-log-only mutation from convex/mutations/scan.ts.
 *
 * `logScanOnly` writes a single row to the `scans` table (one INSERT) with
 * the required real-time-compatible fields: caseId, scannedBy, scannedAt
 * (timestamp), and lat/lng/locationName (location). No status transition,
 * no inspection creation, no events table write.
 *
 * Use when:
 *   • The SCAN app decodes a QR code for "lookup" context (no status change).
 *   • Pre-handoff scan — QR code read to identify the case before starting
 *     the custody handoff workflow (the handoffCustody mutation completes the
 *     action; this call just records that the case was physically scanned).
 *   • Presence verification — scanning to confirm location without advancing
 *     lifecycle status.
 *
 * The single INSERT into `scans` invalidates (real-time, ≤ 2 s):
 *   getScansByCase(caseId)      — T5 scan activity timeline
 *   getLastScanForCase(caseId)  — "Last scanned N min ago"
 *   getScansByUser(scannedBy)   — SCAN app "My Activity" tab
 *   getRecentScans()            — fleet-wide recent scan feed
 *
 * Returns:
 *   LogScanOnlyResult { scanId, scannedAt }
 */
export function useLogScanOnly() {
  return useMutation(api.mutations.scan.logScanOnly);
}

// ─── Canonical checklist mutation hooks ──────────────────────────────────────
//
// These hooks wrap the authoritative mutations in convex/mutations/checklist.ts.
// Unlike useUpdateChecklistItem (which calls api.scan.updateChecklistItem and uses
// the `status` arg name), these hooks use the canonical arg shape (`newStatus`)
// and write to ALL four tables including the immutable `checklist_updates` history.
//
// Use these hooks for all new SCAN app checklist screens:
//   • useChecklistItemUpdate  — full generic update (any status transition)
//   • useMarkItemOk           — "ok" shorthand; omits damage-specific fields
//   • useMarkItemDamaged      — "damaged" shorthand; requires damage evidence
//   • useMarkItemMissing      — "missing" shorthand
//   • useResetChecklistItem   — revert to "unchecked" (undo flow)
//
// All five mutations share the same optimistic update strategy:
//   1. Patch the item in api.checklists.getChecklistByCase
//   2. Recompute summary and patch api.checklists.getChecklistWithInspection
//
// The `updateId` field in the return value is the `checklist_updates` row ID —
// it enables the SCAN app to link photos or follow-up queries to this history row.

/**
 * Shared optimistic update logic for all canonical checklist mutations.
 *
 * Immediately reflects a checklist item status change in two cached queries:
 *   - api.checklists.getChecklistByCase     → item list used by the checklist view
 *   - api.checklists.getChecklistWithInspection → items + recomputed summary
 *
 * Identical to the useUpdateChecklistItem optimistic update except it reads
 * `newStatus` (canonical arg name) instead of `status`.
 *
 * @param localStore  The Convex OptimisticLocalStore provided by withOptimisticUpdate.
 * @param caseId      Convex ID of the parent case.
 * @param templateItemId  Stable template item identifier.
 * @param newStatus   The new inspection state to apply optimistically.
 * @param timestamp   Epoch ms of the update (written to checkedAt).
 * @param technicianId   Kinde user ID of the technician.
 * @param technicianName Display name of the technician.
 * @param notes       Optional notes (only overwritten when provided).
 */
function applyChecklistOptimisticUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localStore: any,
  caseId: Id<"cases">,
  templateItemId: string,
  newStatus: string,
  timestamp: number,
  technicianId: string,
  technicianName: string,
  notes?: string,
): void {
  /**
   * Apply the new status to the matching item in an array of ChecklistItems.
   * Returns a new array — does not mutate in place.
   */
  const applyItemUpdate = <T extends {
    templateItemId: string;
    status: string;
    checkedAt?: number;
    checkedById?: string;
    checkedByName?: string;
    notes?: string;
  }>(items: T[]): T[] =>
    items.map((item) =>
      item.templateItemId === templateItemId
        ? {
            ...item,
            status:        newStatus,
            checkedAt:     timestamp,
            checkedById:   technicianId,
            checkedByName: technicianName,
            ...(notes !== undefined ? { notes } : {}),
          }
        : item
    );

  // Patch getChecklistByCase — the primary item list subscription.
  const checklistItems = localStore.getQuery(
    api.checklists.getChecklistByCase,
    { caseId }
  );
  if (checklistItems !== undefined) {
    localStore.setQuery(
      api.checklists.getChecklistByCase,
      { caseId },
      applyItemUpdate(checklistItems)
    );
  }

  // Patch getChecklistWithInspection — combined view used by ScanInspectClient.
  // Re-run buildSummary so the progress bar and isComplete gate update instantly.
  const checklistWithInsp = localStore.getQuery(
    api.checklists.getChecklistWithInspection,
    { caseId }
  );
  if (checklistWithInsp !== undefined) {
    const updatedItems   = applyItemUpdate(checklistWithInsp.items);
    const updatedSummary = buildSummary(caseId.toString(), updatedItems);
    localStore.setQuery(
      api.checklists.getChecklistWithInspection,
      { caseId },
      {
        ...checklistWithInsp,
        items:   updatedItems,
        summary: updatedSummary,
      }
    );
  }
}

// ─── useChecklistItemUpdate ───────────────────────────────────────────────────

/**
 * Canonical full checklist item update mutation hook.
 *
 * Wraps `api.mutations.checklist.updateChecklistItem` — the authoritative atomic
 * write that records a checklist item state change to ALL relevant tables in a
 * single Convex transaction:
 *   • manifestItems     PATCH  — current status, checkedAt, checkedBy*
 *   • checklist_updates INSERT — immutable history row (returned as `updateId`)
 *   • inspections       PATCH  — aggregate counter sync for M3 map pins
 *   • events            INSERT — item_checked or damage_reported audit event
 *
 * Use this hook instead of `useUpdateChecklistItem` when you need:
 *   • The `updateId` (checklist_updates row ID) for linking photos or queries
 *   • The full atomic guarantee across all four tables
 *   • The `inspectionId` hint for O(1) inspection counter sync
 *
 * Optimistic update patches:
 *   api.checklists.getChecklistByCase         — item status, checkedAt, checkedBy*
 *   api.checklists.getChecklistWithInspection — items + recomputed summary
 *
 * @param args.newStatus — canonical field name (NOT `status`)
 *
 * Returns:
 *   UpdateChecklistItemResult {
 *     itemId, updateId, caseId, previousStatus, newStatus, inspectionCounters
 *   }
 *
 * Usage:
 *   const updateItem = useChecklistItemUpdate();
 *   const result = await updateItem({
 *     caseId:         caseDoc._id,
 *     templateItemId: "item-battery-pack",
 *     newStatus:      "damaged",              // ← canonical field name
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *     damageDescription: "Impact crack on housing",
 *     damageSeverity:    "moderate",
 *   });
 *   console.log("history row:", result.updateId);  // checklist_updates._id
 */
export function useChecklistItemUpdate() {
  return useMutation(api.mutations.checklist.updateChecklistItem).withOptimisticUpdate(
    (localStore, args) => {
      applyChecklistOptimisticUpdate(
        localStore,
        args.caseId,
        args.templateItemId,
        args.newStatus,
        args.timestamp,
        args.technicianId,
        args.technicianName,
        args.notes,
      );
    }
  );
}

// ─── useMarkItemOk ────────────────────────────────────────────────────────────

/**
 * Mark a manifest item as "ok" — confirmed present and undamaged.
 *
 * Wraps `api.mutations.checklist.markItemOk` — the atomic convenience mutation
 * that writes to manifestItems, checklist_updates, inspections, and events
 * in a single transaction with newStatus hardcoded to "ok".
 *
 * Optimistic update immediately reflects the "ok" state in the checklist view
 * and recomputes the summary (progressPct, isComplete).  Convex rolls back
 * automatically if the mutation fails.
 *
 * Usage:
 *   const markOk = useMarkItemOk();
 *   await markOk({
 *     caseId:         caseDoc._id,
 *     templateItemId: "item-battery-pack",
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *   });
 */
export function useMarkItemOk() {
  return useMutation(api.mutations.checklist.markItemOk).withOptimisticUpdate(
    (localStore, args) => {
      applyChecklistOptimisticUpdate(
        localStore,
        args.caseId,
        args.templateItemId,
        "ok",
        args.timestamp,
        args.technicianId,
        args.technicianName,
        args.notes,
      );
    }
  );
}

// ─── useMarkItemDamaged ───────────────────────────────────────────────────────

/**
 * Mark a manifest item as "damaged" with required damage evidence.
 *
 * Wraps `api.mutations.checklist.markItemDamaged` — the atomic convenience
 * mutation with newStatus hardcoded to "damaged".  `damageDescription` and
 * `damageSeverity` are required (enforced server-side).
 *
 * Optimistic update immediately reflects the "damaged" state in the checklist
 * view, updates the summary (damaged count), and increments the progress bar.
 * The optimistic update does NOT write the photo storage IDs because they require
 * server-confirmed upload IDs; photos appear after the round-trip completes.
 *
 * Usage:
 *   const markDamaged = useMarkItemDamaged();
 *   await markDamaged({
 *     caseId:            caseDoc._id,
 *     templateItemId:    "item-battery-pack",
 *     timestamp:         Date.now(),
 *     technicianId:      kindeUser.id,
 *     technicianName:    "Jane Pilot",
 *     damageDescription: "Impact crack on housing near connector port",
 *     damageSeverity:    "moderate",
 *     photoStorageIds:   ["storage_abc123"],
 *   });
 */
export function useMarkItemDamaged() {
  return useMutation(api.mutations.checklist.markItemDamaged).withOptimisticUpdate(
    (localStore, args) => {
      applyChecklistOptimisticUpdate(
        localStore,
        args.caseId,
        args.templateItemId,
        "damaged",
        args.timestamp,
        args.technicianId,
        args.technicianName,
        args.notes,
      );
    }
  );
}

// ─── useMarkItemMissing ───────────────────────────────────────────────────────

/**
 * Mark a manifest item as "missing" — not found during inspection.
 *
 * Wraps `api.mutations.checklist.markItemMissing` — the atomic convenience
 * mutation with newStatus hardcoded to "missing".
 *
 * Optimistic update immediately reflects the "missing" state in the checklist
 * view and updates the summary (missing count, progressPct).
 *
 * Usage:
 *   const markMissing = useMarkItemMissing();
 *   await markMissing({
 *     caseId:         caseDoc._id,
 *     templateItemId: "item-battery-pack",
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *     notes:          "Last seen at turbine T-42",
 *   });
 */
export function useMarkItemMissing() {
  return useMutation(api.mutations.checklist.markItemMissing).withOptimisticUpdate(
    (localStore, args) => {
      applyChecklistOptimisticUpdate(
        localStore,
        args.caseId,
        args.templateItemId,
        "missing",
        args.timestamp,
        args.technicianId,
        args.technicianName,
        args.notes,
      );
    }
  );
}

// ─── useResetChecklistItem ────────────────────────────────────────────────────

/**
 * Reset a manifest item to "unchecked" — undo a previous check-in.
 *
 * Wraps `api.mutations.checklist.resetChecklistItem` — the atomic convenience
 * mutation with newStatus hardcoded to "unchecked".  Used by the SCAN app undo
 * / re-inspect flow when a technician wants to re-review an item they previously
 * marked as ok, damaged, or missing.
 *
 * Optimistic update immediately reflects the "unchecked" state — the item
 * reappears in the useUncheckedItems / useChecklistItemsByStatus("unchecked")
 * results, and the progress percentage decrements correctly.
 *
 * Note: The optimistic update clears checkedAt, checkedById, checkedByName
 * to reflect the "not yet reviewed" state.  Existing notes and photos are
 * preserved (the server does the same — they are cleared only if re-submitted
 * on the next check-in).
 *
 * Usage:
 *   const resetItem = useResetChecklistItem();
 *   await resetItem({
 *     caseId:         caseDoc._id,
 *     templateItemId: "item-battery-pack",
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *     notes:          "Re-checking after case was repacked",
 *   });
 */
export function useResetChecklistItem() {
  return useMutation(api.mutations.checklist.resetChecklistItem).withOptimisticUpdate(
    (localStore, args) => {
      const { caseId, templateItemId, timestamp: _timestamp } = args;

      /**
       * Reset the item to unchecked, clearing check-in metadata.
       * Preserves existing notes and photos (server behaviour).
       */
      const applyReset = <T extends {
        templateItemId: string;
        status: string;
        checkedAt?: number;
        checkedById?: string;
        checkedByName?: string;
      }>(items: T[]): T[] =>
        items.map((item) =>
          item.templateItemId === templateItemId
            ? {
                ...item,
                status:        "unchecked",
                checkedAt:     undefined,
                checkedById:   undefined,
                checkedByName: undefined,
              }
            : item
        );

      // Patch getChecklistByCase
      const checklistItems = localStore.getQuery(
        api.checklists.getChecklistByCase,
        { caseId }
      );
      if (checklistItems !== undefined) {
        localStore.setQuery(
          api.checklists.getChecklistByCase,
          { caseId },
          applyReset(checklistItems)
        );
      }

      // Patch getChecklistWithInspection — recompute summary so progress bar
      // correctly reflects the newly unchecked item.
      const checklistWithInsp = localStore.getQuery(
        api.checklists.getChecklistWithInspection,
        { caseId }
      );
      if (checklistWithInsp !== undefined) {
        const updatedItems   = applyReset(checklistWithInsp.items);
        const updatedSummary = buildSummary(caseId.toString(), updatedItems);
        localStore.setQuery(
          api.checklists.getChecklistWithInspection,
          { caseId },
          {
            ...checklistWithInsp,
            items:   updatedItems,
            summary: updatedSummary,
          }
        );
      }
    }
  );
}
