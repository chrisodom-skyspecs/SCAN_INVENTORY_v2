/**
 * exportAuditCsv.test.ts — Unit tests for the T5 Audit Ledger CSV export utility.
 *
 * Tests that:
 *   - `auditLedgerRowsToCsv` produces a valid RFC 4180 CSV string
 *   - The header row is correct with and without the Hash column
 *   - Timestamps are formatted as ISO 8601 strings
 *   - Fields containing commas, quotes, and newlines are properly escaped
 *   - Empty rows array produces a header-only CSV
 *   - `downloadCsvBlob` creates a Blob, anchor, and triggers a click
 *   - `exportAuditLedgerCsv` derives a safe filename from caseId
 *   - Edge-case caseIds (empty string, special characters) produce valid filenames
 *
 * Mocking strategy:
 *   - URL.createObjectURL / URL.revokeObjectURL are stubbed to return a fake URL.
 *   - document.createElement is partially intercepted for anchor elements.
 *   - anchor.click is mocked to prevent real navigation.
 *   - document.body.appendChild / removeChild are mocked to track element lifecycle.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  auditLedgerRowsToCsv,
  downloadCsvBlob,
  exportAuditLedgerCsv,
} from "../exportAuditCsv";
import type { AuditLedgerRow } from "../../components/CaseDetail/AuditLedgerTable";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TIMESTAMP_MS = 1700000000000; // 2023-11-14T22:13:20.000Z

const ROW_A: AuditLedgerRow = {
  id:        "event-001",
  timestamp: TIMESTAMP_MS,
  actor:     "Jane Smith",
  action:    "Status Changed",
  caseId:    "j57abc1234567890",
};

const ROW_WITH_HASH: AuditLedgerRow = {
  id:        "event-002",
  timestamp: TIMESTAMP_MS + 60_000,
  actor:     "Bob O'Brien",
  action:    "Shipped",
  caseId:    "j57abc1234567890",
  hash:      "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
};

const ROW_WITH_SPECIAL_CHARS: AuditLedgerRow = {
  id:        "event-003",
  timestamp: TIMESTAMP_MS + 120_000,
  actor:     'Actor, "The Great"',
  action:    "Note Added",
  caseId:    "j57abc1234567890",
};

// ─── auditLedgerRowsToCsv ─────────────────────────────────────────────────────

describe("auditLedgerRowsToCsv", () => {
  it("produces a header-only CSV when rows is empty (no hash column)", () => {
    const csv = auditLedgerRowsToCsv([], false);
    expect(csv).toBe("Timestamp,Actor,Action,Case ID\r\n");
  });

  it("produces a header-only CSV when rows is empty (with hash column)", () => {
    const csv = auditLedgerRowsToCsv([], true);
    expect(csv).toBe("Timestamp,Actor,Action,Case ID,Hash\r\n");
  });

  it("includes 4 columns when ffEnabled=false (no Hash column)", () => {
    const csv = auditLedgerRowsToCsv([ROW_A], false);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2); // header + 1 data row
    const headerCols = lines[0].split(",");
    expect(headerCols).toHaveLength(4);
    expect(headerCols).toEqual(["Timestamp", "Actor", "Action", "Case ID"]);
  });

  it("includes 5 columns when ffEnabled=true (with Hash column)", () => {
    const csv = auditLedgerRowsToCsv([ROW_A], true);
    const lines = csv.split("\r\n").filter(Boolean);
    const headerCols = lines[0].split(",");
    expect(headerCols).toHaveLength(5);
    expect(headerCols[4]).toBe("Hash");
  });

  it("formats timestamps as ISO 8601 strings", () => {
    const csv = auditLedgerRowsToCsv([ROW_A], false);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toContain(new Date(TIMESTAMP_MS).toISOString());
  });

  it("writes the actor, action, and caseId fields correctly", () => {
    const csv = auditLedgerRowsToCsv([ROW_A], false);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toContain("Jane Smith");
    expect(dataLine).toContain("Status Changed");
    expect(dataLine).toContain("j57abc1234567890");
  });

  it("includes the full hash in the 5th column when ffEnabled=true", () => {
    const csv = auditLedgerRowsToCsv([ROW_WITH_HASH], true);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toContain(ROW_WITH_HASH.hash);
  });

  it("writes empty string for missing hash when ffEnabled=true", () => {
    const csv = auditLedgerRowsToCsv([ROW_A], true);
    const dataLine = csv.split("\r\n")[1];
    // Last field should be empty — row ends with a comma then nothing
    expect(dataLine.endsWith(",")).toBe(true);
  });

  it("escapes fields containing commas by wrapping in double-quotes", () => {
    const rowWithComma: AuditLedgerRow = {
      ...ROW_A,
      action: "Item, checked",
    };
    const csv = auditLedgerRowsToCsv([rowWithComma], false);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toContain('"Item, checked"');
  });

  it("escapes fields containing double-quotes by doubling them", () => {
    const csv = auditLedgerRowsToCsv([ROW_WITH_SPECIAL_CHARS], false);
    const dataLine = csv.split("\r\n")[1];
    // 'Actor, "The Great"' → wrapped in quotes + inner quotes doubled
    expect(dataLine).toContain('"Actor, ""The Great"""');
  });

  it("uses CRLF line endings as required by RFC 4180", () => {
    const csv = auditLedgerRowsToCsv([ROW_A], false);
    // Every line break should be CRLF, not bare LF
    expect(csv).toContain("\r\n");
    // No bare LF that isn't preceded by CR
    const bareLfMatches = csv.match(/(?<!\r)\n/g);
    expect(bareLfMatches).toBeNull();
  });

  it("appends a trailing CRLF after the last data row", () => {
    const csv = auditLedgerRowsToCsv([ROW_A], false);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("produces correct output for multiple rows (newest-first typical order)", () => {
    const csv = auditLedgerRowsToCsv([ROW_WITH_HASH, ROW_A], false);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 data rows
    // First data row should be ROW_WITH_HASH (as passed — no re-sorting in util)
    expect(lines[1]).toContain("Shipped");
    expect(lines[2]).toContain("Status Changed");
  });
});

// ─── downloadCsvBlob ──────────────────────────────────────────────────────────

describe("downloadCsvBlob", () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let createdAnchor: HTMLAnchorElement | null = null;
  let appendChildSpy: ReturnType<typeof vi.fn>;
  let removeChildSpy: ReturnType<typeof vi.fn>;
  let createObjectUrlSpy: ReturnType<typeof vi.fn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    clickSpy = vi.fn();
    appendChildSpy = vi.spyOn(document.body, "appendChild").mockImplementation((el) => {
      createdAnchor = el as HTMLAnchorElement;
      return el;
    });
    removeChildSpy = vi.spyOn(document.body, "removeChild").mockImplementation(() => createdAnchor as HTMLAnchorElement);
    // `contains` returns false for mocked anchors (not actually appended) —
    // mock it to return true so the removeChild guard doesn't short-circuit.
    vi.spyOn(document.body, "contains").mockReturnValue(true);

    createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-url");
    revokeObjectUrlSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    // Intercept createElement("a") to inject our click spy
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") {
        const anchor = originalCreateElement("a") as HTMLAnchorElement;
        // Cast required: vi.fn() vs the narrower () => void DOM type
        (anchor as unknown as Record<string, unknown>).click = clickSpy;
        createdAnchor = anchor;
        return anchor;
      }
      return originalCreateElement(tag);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    createdAnchor = null;
  });

  it("creates a Blob with CSV MIME type", () => {
    let capturedOptions: BlobPropertyBag | undefined;
    const BlobSpy = vi.spyOn(global, "Blob").mockImplementation(function(
      this: unknown,
      _parts: BlobPart[],
      options?: BlobPropertyBag,
    ) {
      capturedOptions = options;
      return { size: 0, type: "text/csv;charset=utf-8;" } as Blob;
    } as unknown as typeof Blob);

    downloadCsvBlob("test.csv", "header\r\nrow1\r\n");
    // Blob constructor was called with the correct MIME type
    expect(BlobSpy).toHaveBeenCalled();
    expect(capturedOptions?.type).toContain("text/csv");
    BlobSpy.mockRestore();
  });

  it("sets the anchor href to the object URL", () => {
    downloadCsvBlob("test.csv", "content\r\n");
    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(createdAnchor?.href).toContain("blob:");
  });

  it("sets the anchor download attribute to the provided filename", () => {
    downloadCsvBlob("audit-case123.csv", "content\r\n");
    expect(createdAnchor?.download).toBe("audit-case123.csv");
  });

  it("programmatically clicks the anchor", () => {
    downloadCsvBlob("test.csv", "content\r\n");
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("appends the anchor to document.body before clicking", () => {
    downloadCsvBlob("test.csv", "content\r\n");
    expect(appendChildSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it("revokes the object URL after a 100ms delay", () => {
    downloadCsvBlob("test.csv", "content\r\n");
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:mock-url");
  });

  it("removes the anchor from document.body after a 100ms delay", () => {
    downloadCsvBlob("test.csv", "content\r\n");
    expect(removeChildSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(removeChildSpy).toHaveBeenCalled();
  });
});

// ─── exportAuditLedgerCsv ─────────────────────────────────────────────────────

describe("exportAuditLedgerCsv", () => {
  let downloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // Stub out the DOM APIs used by downloadCsvBlob
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(document.body, "appendChild").mockImplementation((el) => el);
    vi.spyOn(document.body, "removeChild").mockImplementation(() => null as unknown as Node);

    // Track anchor creation to capture the download attribute
    downloadSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") {
        const anchor = originalCreate("a") as HTMLAnchorElement;
        Object.defineProperty(anchor, "download", {
          // Cast required: vi.fn() vs ((v: string) => void) | undefined
          set: downloadSpy as unknown as ((v: string) => void),
          get: () => (downloadSpy.mock.calls.at(-1) as [string] | undefined)?.[0] ?? "",
          configurable: true,
        });
        (anchor as unknown as Record<string, unknown>).click = vi.fn();
        return anchor;
      }
      return originalCreate(tag);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("derives filename as 'audit-<safeId>.csv' from a normal caseId", () => {
    exportAuditLedgerCsv([ROW_A], "j57abc1234567890", false);
    expect(downloadSpy).toHaveBeenCalledWith("audit-j57abc1234567890.csv");
  });

  it("replaces non-alphanumeric characters in caseId with hyphens", () => {
    exportAuditLedgerCsv([ROW_A], "case id with spaces!", false);
    // "case id with spaces!" → "case-id-with-spaces-"
    expect(downloadSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^audit-case-id-with-spaces.*\.csv$/)
    );
  });

  it("uses 'export' as fallback filename when caseId is empty", () => {
    exportAuditLedgerCsv([ROW_A], "", false);
    expect(downloadSpy).toHaveBeenCalledWith("audit-export.csv");
  });

  it("passes ffEnabled=true to include the Hash column in the CSV", () => {
    // Spy on auditLedgerRowsToCsv indirectly by checking the Blob content
    const BlobSpy = vi.spyOn(global, "Blob").mockImplementation(function(
      this: Blob,
      parts: BlobPart[],
    ) {
      const content = String(parts[0]);
      // BOM prefix + header should contain "Hash"
      expect(content).toContain("Hash");
      return { size: content.length, type: "text/csv" } as unknown as Blob;
    } as unknown as typeof Blob);

    exportAuditLedgerCsv([ROW_WITH_HASH], "case-001", true);
    expect(BlobSpy).toHaveBeenCalled();
    BlobSpy.mockRestore();
  });

  it("passes ffEnabled=false to exclude the Hash column", () => {
    const BlobSpy = vi.spyOn(global, "Blob").mockImplementation(function(
      this: Blob,
      parts: BlobPart[],
    ) {
      const content = String(parts[0]);
      // Header should NOT contain "Hash" when ffEnabled=false
      const firstLine = content.split("\r\n")[0];
      expect(firstLine).not.toContain("Hash");
      return { size: content.length, type: "text/csv" } as unknown as Blob;
    } as unknown as typeof Blob);

    exportAuditLedgerCsv([ROW_A], "case-001", false);
    expect(BlobSpy).toHaveBeenCalled();
    BlobSpy.mockRestore();
  });

  it("prepends a UTF-8 BOM to ensure Excel compatibility", () => {
    const BlobSpy = vi.spyOn(global, "Blob").mockImplementation(function(
      this: Blob,
      parts: BlobPart[],
    ) {
      const content = String(parts[0]);
      // UTF-8 BOM is U+FEFF — first character of the blob content
      expect(content.charCodeAt(0)).toBe(0xFEFF);
      return { size: content.length, type: "text/csv" } as unknown as Blob;
    } as unknown as typeof Blob);

    exportAuditLedgerCsv([ROW_A], "case-001", false);
    expect(BlobSpy).toHaveBeenCalled();
    BlobSpy.mockRestore();
  });
});
