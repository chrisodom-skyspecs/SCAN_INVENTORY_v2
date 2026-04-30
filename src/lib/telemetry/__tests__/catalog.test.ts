/**
 * Unit tests for lib/telemetry/catalog.ts
 *
 * Coverage areas
 * ──────────────
 * 1.  Catalog completeness         — every TelemetryEventName has an entry
 * 2.  Base fields                  — every entry includes the auto-filled base
 * 3.  Discriminator agreement      — entry.eventCategory matches the type
 * 4.  Lookup helpers               — getCatalogEntry / getEventsBy*
 * 5.  Domain coverage              — every spec §23 domain has at least one event
 * 6.  validateTelemetryEvent       — accepts valid, rejects malformed events
 * 7.  validateTelemetryEvent       — flags missing required fields
 * 8.  validateTelemetryEvent       — flags discriminator mismatches
 */

import { describe, expect, it } from "vitest";
import {
  TELEMETRY_EVENT_BASE_FIELDS,
  TELEMETRY_EVENT_CATALOG,
  TELEMETRY_EVENT_CATALOG_ENTRIES,
  getAllEventNames,
  getCatalogEntry,
  getEventsByApp,
  getEventsByCategory,
  getEventsByDomain,
  validateTelemetryEvent,
} from "../catalog";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Catalog completeness ─────────────────────────────────────────────────────

describe("TELEMETRY_EVENT_CATALOG", () => {
  it("contains an entry for every TelemetryEventName constant", () => {
    const allNames = Object.values(TelemetryEventName);
    for (const name of allNames) {
      expect(TELEMETRY_EVENT_CATALOG).toHaveProperty(name);
    }
  });

  it("entries match their indexing key (no copy-paste errors)", () => {
    for (const [key, entry] of Object.entries(TELEMETRY_EVENT_CATALOG)) {
      expect(entry.eventName).toBe(key);
    }
  });

  it("every entry's requiredFields includes all base fields", () => {
    for (const entry of TELEMETRY_EVENT_CATALOG_ENTRIES) {
      for (const baseField of TELEMETRY_EVENT_BASE_FIELDS) {
        expect(entry.requiredFields).toContain(baseField);
      }
    }
  });

  it("requiredFields and optionalFields never overlap", () => {
    for (const entry of TELEMETRY_EVENT_CATALOG_ENTRIES) {
      const required = new Set(entry.requiredFields);
      for (const optional of entry.optionalFields) {
        expect(required.has(optional)).toBe(false);
      }
    }
  });

  it("every entry has a non-empty description", () => {
    for (const entry of TELEMETRY_EVENT_CATALOG_ENTRIES) {
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

// ─── Lookup helpers ───────────────────────────────────────────────────────────

describe("getCatalogEntry()", () => {
  it("returns the entry for a known event name", () => {
    const entry = getCatalogEntry(TelemetryEventName.SCAN_ACTION_QR_SCANNED);
    expect(entry.eventName).toBe(TelemetryEventName.SCAN_ACTION_QR_SCANNED);
    expect(entry.eventCategory).toBe("user_action");
    expect(entry.app).toBe("scan");
    expect(entry.domain).toBe("scan");
  });

  it("returns undefined for an unknown event name (string overload)", () => {
    expect(getCatalogEntry("not:a:real:event")).toBeUndefined();
  });
});

describe("getEventsByCategory()", () => {
  it("returns only navigation events when filtering by 'navigation'", () => {
    const navEvents = getEventsByCategory("navigation");
    expect(navEvents.length).toBeGreaterThan(0);
    for (const e of navEvents) {
      expect(e.eventCategory).toBe("navigation");
    }
  });

  it("returns disjoint sets across categories", () => {
    const cats = ["navigation", "user_action", "error", "performance"] as const;
    const total = cats
      .map((c) => getEventsByCategory(c).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(TELEMETRY_EVENT_CATALOG_ENTRIES.length);
  });
});

describe("getEventsByApp()", () => {
  it("includes 'any' events for both apps", () => {
    const inv = getEventsByApp("inventory");
    const scan = getEventsByApp("scan");
    const anyEntry = TELEMETRY_EVENT_CATALOG_ENTRIES.find((e) => e.app === "any");
    if (anyEntry) {
      expect(inv).toContainEqual(anyEntry);
      expect(scan).toContainEqual(anyEntry);
    }
  });
});

describe("getEventsByDomain()", () => {
  it("returns at least one event for every spec §23 domain", () => {
    for (const domain of [
      "scan",
      "inspection",
      "damage",
      "shipping",
      "handoff",
      "navigation",
    ] as const) {
      const events = getEventsByDomain(domain);
      expect(events.length).toBeGreaterThan(0);
    }
  });

  it("returns the QR scan funnel events for the 'scan' domain", () => {
    const scanDomain = getEventsByDomain("scan").map((e) => e.eventName);
    expect(scanDomain).toContain(TelemetryEventName.SCAN_NAV_SCANNER_OPENED);
    expect(scanDomain).toContain(TelemetryEventName.SCAN_ACTION_QR_SCANNED);
    expect(scanDomain).toContain(
      TelemetryEventName.SCAN_ACTION_CONTEXT_SELECTED,
    );
  });
});

describe("getAllEventNames()", () => {
  it("returns every registered event name", () => {
    const names = getAllEventNames();
    expect(names.length).toBe(Object.values(TelemetryEventName).length);
    expect(new Set(names).size).toBe(names.length); // unique
  });
});

// ─── validateTelemetryEvent ──────────────────────────────────────────────────

describe("validateTelemetryEvent()", () => {
  it("accepts a complete valid event", () => {
    const result = validateTelemetryEvent({
      eventCategory: "user_action",
      eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
      app: "scan",
      sessionId: "abc-123",
      timestamp: 1_730_000_000_000,
      success: true,
      scanDurationMs: 350,
      method: "camera",
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.missingFields).toEqual([]);
    expect(result.entry?.eventName).toBe(
      TelemetryEventName.SCAN_ACTION_QR_SCANNED,
    );
  });

  it("flags missing required fields", () => {
    const result = validateTelemetryEvent({
      eventCategory: "user_action",
      eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
      app: "scan",
      sessionId: "abc-123",
      timestamp: 1_730_000_000_000,
      // success / scanDurationMs / method missing
    });

    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual(
      expect.arrayContaining(["success", "scanDurationMs", "method"]),
    );
  });

  it("flags an unknown eventName", () => {
    const result = validateTelemetryEvent({
      eventCategory: "user_action",
      eventName: "not:a:real:event",
      app: "scan",
      sessionId: "abc-123",
      timestamp: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Unknown eventName/);
  });

  it("flags a non-object payload", () => {
    expect(validateTelemetryEvent(null).valid).toBe(false);
    expect(validateTelemetryEvent("string").valid).toBe(false);
    expect(validateTelemetryEvent([]).valid).toBe(false);
  });

  it("flags eventCategory mismatch", () => {
    const result = validateTelemetryEvent({
      eventCategory: "navigation", // wrong category
      eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
      app: "scan",
      sessionId: "abc",
      timestamp: 1,
      success: true,
      scanDurationMs: 1,
      method: "camera",
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/eventCategory/);
  });

  it("flags app mismatch when catalog app is not 'any'", () => {
    const result = validateTelemetryEvent({
      eventCategory: "user_action",
      eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
      app: "inventory", // wrong app
      sessionId: "abc",
      timestamp: 1,
      success: true,
      scanDurationMs: 1,
      method: "camera",
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/app/);
  });

  it("accepts events whose catalog app is 'any' regardless of payload app", () => {
    const result = validateTelemetryEvent({
      eventCategory: "error",
      eventName: TelemetryEventName.ERROR_UNHANDLED_EXCEPTION,
      app: "scan",
      sessionId: "abc",
      timestamp: 1,
      errorCode: "BOOM",
      errorMessage: "exploded",
      recoverable: false,
      stackTrace: "at foo()",
      errorBoundary: "AppRoot",
    });

    expect(result.valid).toBe(true);
  });
});
