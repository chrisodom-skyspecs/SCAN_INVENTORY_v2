/**
 * exportAuditCsv — client-side CSV generation for the T5 Audit Ledger
 *
 * Converts AuditLedgerRow[] to a RFC 4180-compliant CSV string and
 * triggers a Blob-based download via a synthetic anchor click.
 *
 * Column layout (matches the AuditLedgerTable display order):
 *   Timestamp  — ISO 8601 string (sortable, locale-independent)
 *   Actor      — User display name (userName)
 *   Action     — Human-readable event type label
 *   Case ID    — Convex document ID
 *   Hash       — SHA-256 hash (included only when ffEnabled=true)
 *
 * The Timestamp column uses ISO 8601 format (not locale strings) so the
 * exported CSV can be sorted and processed unambiguously in any spreadsheet
 * application regardless of the user's locale.
 *
 * Usage:
 *   import { exportAuditLedgerCsv } from "@/lib/exportAuditCsv";
 *
 *   exportAuditLedgerCsv(rows, caseId, ffEnabled);
 *   // → triggers browser download of "audit-<caseId>.csv"
 */

import type { AuditLedgerRow } from "../components/CaseDetail/AuditLedgerTable";

// ─── CSV field escaping ───────────────────────────────────────────────────────

/**
 * Escape a single CSV field value per RFC 4180:
 *   - Wrap in double-quotes when the value contains a comma, double-quote,
 *     carriage return, or newline.
 *   - Escape embedded double-quotes by doubling them ("" → "").
 *   - Return the plain string as-is when no special characters are present.
 *
 * @param value  Raw field value (will be coerced to string).
 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── Timestamp formatting ─────────────────────────────────────────────────────

/**
 * Format an epoch-ms timestamp as an ISO 8601 string for CSV export.
 *
 * ISO 8601 is preferred over locale strings in exported data because:
 *   • It is unambiguous across all locales and timezones.
 *   • It sorts lexicographically in spreadsheet applications.
 *   • It is parseable by Excel, LibreOffice Calc, Google Sheets, and pandas.
 *
 * Example output: "2024-11-15T18:30:00.000Z"
 */
function formatTimestampIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

// ─── CSV string generation ────────────────────────────────────────────────────

/**
 * Convert an array of AuditLedgerRow objects to a RFC 4180-compliant CSV string.
 *
 * Column order:
 *   1. Timestamp  — ISO 8601 (always included)
 *   2. Actor      — display name (always included)
 *   3. Action     — event type label (always included)
 *   4. Case ID    — Convex document ID (always included)
 *   5. Hash       — SHA-256 prefix (included only when ffEnabled=true)
 *
 * The string uses CRLF (\r\n) line endings as required by RFC 4180.
 * A trailing CRLF is appended after the last data row.
 *
 * When `rows` is empty, only the header row is returned (plus the trailing CRLF),
 * which produces a valid zero-data CSV that applications can open without errors.
 *
 * @param rows      Audit ledger rows to serialise.
 * @param ffEnabled When true, appends the Hash column.
 * @returns RFC 4180 CSV string with header + data rows.
 */
export function auditLedgerRowsToCsv(
  rows: AuditLedgerRow[],
  ffEnabled: boolean,
): string {
  const CRLF = "\r\n";

  // ── Header ────────────────────────────────────────────────────────────────
  const headers = ["Timestamp", "Actor", "Action", "Case ID"];
  if (ffEnabled) {
    headers.push("Hash");
  }
  const headerLine = headers.map(escapeCsvField).join(",");

  // ── Data rows ─────────────────────────────────────────────────────────────
  const dataLines = rows.map((row) => {
    const fields: string[] = [
      formatTimestampIso(row.timestamp),
      row.actor,
      row.action,
      row.caseId,
    ];
    if (ffEnabled) {
      // Use the full hash when available; empty string when absent.
      fields.push(row.hash ?? "");
    }
    return fields.map(escapeCsvField).join(",");
  });

  // ── Join with CRLF, append trailing CRLF ─────────────────────────────────
  return [headerLine, ...dataLines].join(CRLF) + CRLF;
}

// ─── Blob download helper ─────────────────────────────────────────────────────

/**
 * Trigger a client-side file download using a Blob Object URL.
 *
 * Creates a temporary invisible `<a>` element with `href` pointing to a Blob
 * URL and `download` set to the desired filename, programmatically clicks it,
 * then schedules cleanup (URL revocation + element removal) via setTimeout.
 *
 * The 100 ms cleanup delay ensures the browser has time to initiate the
 * download before the Object URL is revoked — tested in Chrome, Firefox,
 * Safari, and Edge.
 *
 * This helper is intentionally side-effectful and must only be called from
 * event handlers or `useEffect` (never during render).
 *
 * @param filename    Suggested filename shown in the browser save dialog.
 * @param csvContent  RFC 4180 CSV string to write to the download file.
 */
export function downloadCsvBlob(filename: string, csvContent: string): void {
  // BOM (U+FEFF) prefix ensures Excel opens the CSV in UTF-8 mode on Windows
  // without garbled characters in actor names / case IDs that contain non-ASCII.
  const bom = "﻿";
  const blob = new Blob([bom + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();

  // Deferred cleanup — revoke the Object URL and remove the element after the
  // browser has had time to initiate the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (document.body.contains(anchor)) {
      document.body.removeChild(anchor);
    }
  }, 100);
}

// ─── Convenience export ───────────────────────────────────────────────────────

/**
 * Generate and immediately download a CSV file for the T5 Audit Ledger.
 *
 * Combines `auditLedgerRowsToCsv` and `downloadCsvBlob` into a single call.
 * The download filename is derived from the `caseId` with non-filename-safe
 * characters replaced by hyphens.
 *
 * Call this from a button `onClick` handler or similar user-initiated event.
 *
 * @param rows      Audit ledger rows currently visible in the table.
 * @param caseId    Case ID used to derive the download filename.
 * @param ffEnabled Whether to include the Hash column in the export.
 *
 * @example
 *   // In a React component:
 *   const handleExportCsv = useCallback(() => {
 *     exportAuditLedgerCsv(latestRowsRef.current, caseId, ffEnabled);
 *   }, [caseId, ffEnabled]);
 */
export function exportAuditLedgerCsv(
  rows: AuditLedgerRow[],
  caseId: string,
  ffEnabled: boolean,
): void {
  const csvContent = auditLedgerRowsToCsv(rows, ffEnabled);

  // Sanitise caseId for use in a filename — replace sequences of characters
  // that are not alphanumeric, underscore, or hyphen with a single hyphen.
  const safeId = caseId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  const filename = `audit-${safeId || "export"}.csv`;

  downloadCsvBlob(filename, csvContent);
}
