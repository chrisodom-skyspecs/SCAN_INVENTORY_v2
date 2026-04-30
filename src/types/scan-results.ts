/**
 * Browser-safe result types for SCAN-facing Convex mutations.
 *
 * These mirror the public mutation return shapes without importing Convex
 * function modules into client bundles.
 */

export interface ScanCheckInResult {
  caseId: string;
  previousStatus: string;
  newStatus: string;
  scanId: string;
  inspectionId: string | undefined;
}

export interface UpdateChecklistItemResult {
  itemId: string;
  previousStatus: string;
  newStatus: string;
  inspectionCounters: {
    totalItems: number;
    checkedItems: number;
    damagedItems: number;
    missingItems: number;
  };
}

export interface InspectionResult {
  inspectionId: string;
  caseId: string;
  status: string;
}

export interface CheckInCaseResult {
  scanId: string;
  caseId: string;
  previousStatus: string;
  newStatus: string;
  scannedAt: number;
  inspectionId: string | undefined;
}

export interface LogScanOnlyResult {
  scanId: string;
  scannedAt: number;
}

export interface RecordScanEventResult {
  scanId: string;
  caseId: string;
  scannedAt: number;
}

export interface ShipCaseResult {
  caseId: string;
  shipmentId: string;
  trackingNumber: string;
  carrier: string;
  shippedAt: number;
  previousStatus: string;
}

export interface HandoffCustodyResult {
  custodyRecordId: string;
  caseId: string;
  fromUserId: string;
  toUserId: string;
  handoffAt: number;
  eventId: string;
}

export interface QrCodeValidationResult {
  status:
    | "available"
    | "mapped_to_this_case"
    | "mapped_to_other_case"
    | "invalid";
  reason?: string;
  conflictingCaseLabel?: string;
  conflictingCaseId?: string;
}

export interface GenerateQRCodeResult {
  caseId: string;
  qrCode: string;
  wasRegenerated: boolean;
  previousQrCode?: string;
}

export interface AssociateQRCodeResult {
  caseId: string;
  qrCode: string;
  wasAlreadyMapped: boolean;
}
