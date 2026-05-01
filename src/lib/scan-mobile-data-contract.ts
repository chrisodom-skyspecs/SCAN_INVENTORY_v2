import type { CaseStatus } from "@/types/case-status";

export type ScanMobileFrame =
  | "today"
  | "scanner"
  | "caseDetail"
  | "manifestVerify"
  | "conditionNote"
  | "settingsSync"
  | "unitProfile";

export const SCAN_MOBILE_FRAME_DATA: Record<ScanMobileFrame, readonly string[]> = {
  today: [
    "current user identity and role",
    "cases currently held by the signed-in user",
    "case status, site, latest custody or event age",
    "manifest and handoff tasks due today",
    "queued offline write count",
  ],
  scanner: [
    "case lookup by QR payload or manual identifier",
    "case status, location, and current custody holder",
    "server-recommended next action",
  ],
  caseDetail: [
    "case hero, status, current holder, and location",
    "latest custody handoff",
    "recent audit events",
    "manifest progress and latest condition flags",
    "active carrier or outbound shipment summary",
  ],
  manifestVerify: [
    "manifest items grouped by category",
    "per-item serial, status, notes, and photos",
    "verification progress and discrepancies",
    "signature or offline sign-off state",
  ],
  conditionNote: [
    "case, manifest item, or unit context",
    "component, severity, summary, reporter, and photos",
    "one audit event linking the note back to the case timeline",
  ],
  settingsSync: [
    "signed-in user profile",
    "SCAN density, theme, and default scan mode preferences",
    "local offline queue metadata",
    "cached case and manifest summaries",
  ],
  unitProfile: [
    "durable unit identity and current containing case",
    "firmware, flight hours, battery cycles, calibration, and QC facts",
    "serial-traveling quirks",
    "filtered timeline counts for flags, custody, maintenance, notes, and calibration",
  ],
};

export const SCAN_MOBILE_STATUS_LABELS: Record<CaseStatus, string> = {
  hangar: "In hangar",
  assembled: "Assembled",
  transit_out: "In transit",
  deployed: "Deployed",
  flagged: "Flagged",
  recalled: "Recalled",
  transit_in: "Returning",
  received: "Received",
  archived: "Archived",
};

export function scanMobileStatusLabel(status: CaseStatus) {
  return SCAN_MOBILE_STATUS_LABELS[status];
}
