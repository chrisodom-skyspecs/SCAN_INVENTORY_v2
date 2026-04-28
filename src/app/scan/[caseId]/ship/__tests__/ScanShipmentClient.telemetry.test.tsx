// @vitest-environment jsdom

/**
 * Unit tests: FedEx label generation telemetry in ScanShipmentClient.
 *
 * Verifies that the correct SCAN_ACTION_SHIPMENT_SUBMITTED telemetry event is
 * emitted when a FedEx tracking number is successfully recorded in the SCAN
 * app shipment screen (spec §23).
 *
 * Per-event fields verified:
 *   • eventCategory   = "user_action"
 *   • eventName       = SCAN_ACTION_SHIPMENT_SUBMITTED
 *   • app             = "scan"
 *   • caseId          — the case the shipment belongs to
 *   • success         = true (only emitted on successful mutation)
 *   • carrier         = "FedEx"
 *   • trackingNumber  — the FedEx tracking number recorded by the technician
 *   • initiatingUserId — Kinde user ID of the technician who submitted
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at module level so we can assert on emitted
 *   events without any real transport or Convex backend.
 * • `convex/react` (useQuery, useMutation) are mocked to control loading
 *   state and mutation results.
 * • `use-scan-mutations` is mocked to expose a spy on `useShipCase`.
 * • `use-fedex-tracking` is mocked to return `hasTracking = false` so the
 *   TrackingEntryForm renders (the form is the screen that emits the event).
 * • Tests use `waitFor` to account for the async mutation + telemetry sequence.
 *
 * Covered scenarios
 * ─────────────────
 *  1. Successful submission emits SCAN_ACTION_SHIPMENT_SUBMITTED
 *  2. eventCategory = "user_action", app = "scan"
 *  3. caseId is included in the event
 *  4. success = true on successful mutation
 *  5. carrier = "FedEx" always
 *  6. trackingNumber matches the value entered in the input
 *  7. initiatingUserId = "scan-user" (placeholder Kinde ID)
 *  8. No telemetry emitted when the mutation rejects
 *  9. No telemetry emitted when tracking number is empty (form not submitted)
 * 10. Exactly one event emitted per successful submission (no duplicates)
 */

import React from "react";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Mock telemetry (spy on trackEvent, never hit transport) ──────────────────

const mockTrackEvent = vi.fn();

vi.mock("@/lib/telemetry.lib", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  telemetry: {
    track: vi.fn(),
    identify: vi.fn(),
    flush: vi.fn(),
  },
}));

// ─── Mock convex/react ────────────────────────────────────────────────────────

vi.mock("convex/react", () => ({
  useQuery:    vi.fn(),
  useMutation: vi.fn(),
}));

// ─── Mock the Convex generated API ───────────────────────────────────────────

vi.mock("../../../../../../convex/_generated/api", () => ({
  api: {
    cases: {
      getCaseById: "cases:getCaseById",
    },
    shipping: {
      listShipmentsByCase: "shipping:listShipmentsByCase",
      shipCase:            "shipping:shipCase",
    },
  },
}));

// ─── Mock use-fedex-tracking ──────────────────────────────────────────────────
// Default: no tracking number on file → TrackingEntryForm renders.

vi.mock("../../../../../hooks/use-fedex-tracking", () => ({
  useFedExTracking: vi.fn(() => ({
    hasTracking:      false,
    latestShipment:   null,
    shipments:        [],
    liveTracking:     null,
    isRefreshing:     false,
    refreshError:     null,
    refreshTracking:  vi.fn(),
    isActiveShipment: false,
  })),
}));

// ─── Mock use-scan-mutations ──────────────────────────────────────────────────
// We delegate to a module-level variable so individual tests can swap the
// implementation via `mockShipCaseImpl` without re-mocking the module.

let mockShipCaseImpl: (...args: unknown[]) => Promise<unknown> =
  () => Promise.resolve({ caseId: "", shipmentId: "" });

const mockShipCaseFn = vi.fn((...args: unknown[]) => mockShipCaseImpl(...args));

vi.mock("../../../../../hooks/use-scan-mutations", () => ({
  useShipCase: () => mockShipCaseFn,
}));

// ─── Import SUT and mocked modules (after vi.mock hoisting) ──────────────────

import { useQuery } from "convex/react";
import { ScanShipmentClient } from "../ScanShipmentClient";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID        = "case_telemetry_ship_test";
const TRACKING_NUM   = "794644823741";
const INITIATING_UID = "scan-user";

/** Minimal case document returned by getCaseById. */
const MOCK_CASE = {
  _id:           CASE_ID,
  _creationTime: 1_700_000_000_000,
  label:         "CASE-SHIP-001",
  status:        "assembled" as const,
  locationName:  "Site Alpha",
};

// ─── Mock factories ────────────────────────────────────────────────────────────

/** Returns a resolving shipCase implementation. */
function makeShipCaseMockSuccess(): (...args: unknown[]) => Promise<unknown> {
  return () => Promise.resolve({ caseId: CASE_ID, shipmentId: "shipment_001" });
}

/** Returns a rejecting shipCase implementation. */
function makeShipCaseMockFailure(): (...args: unknown[]) => Promise<unknown> {
  return () => Promise.reject(new Error("Convex mutation failed: shipCase"));
}

// ─── Test setup helpers ───────────────────────────────────────────────────────

interface SetupOptions {
  shipMock?: (...args: unknown[]) => Promise<unknown>;
}

/**
 * Wire Convex mocks and render the ScanShipmentClient in the
 * "no tracking number yet" state (TrackingEntryForm rendered).
 */
function setupAndRender(options: SetupOptions = {}) {
  mockShipCaseImpl = options.shipMock ?? makeShipCaseMockSuccess();

  (useQuery as ReturnType<typeof vi.fn>).mockImplementation(
    (queryFn: unknown) => {
      if (queryFn === "cases:getCaseById") return MOCK_CASE;
      // listShipmentsByCase is consumed by use-fedex-tracking (mocked above)
      return [];
    }
  );

  render(<ScanShipmentClient caseId={CASE_ID} />);
}

/**
 * Fill the tracking number field and submit the form.
 * `value` defaults to TRACKING_NUM.
 */
async function fillAndSubmit(value: string = TRACKING_NUM) {
  const input = screen.getByLabelText(/FedEx Tracking Number/i);
  fireEvent.change(input, { target: { value } });

  const submitBtn = screen.getByRole("button", { name: /Record Shipment/i });
  fireEvent.click(submitBtn);
}

/** Filter mockTrackEvent calls to SCAN_ACTION_SHIPMENT_SUBMITTED events only. */
function getShipmentSubmittedCalls(): Record<string, unknown>[] {
  return mockTrackEvent.mock.calls
    .map((args: unknown[]) => args[0] as Record<string, unknown>)
    .filter(
      (e) => e.eventName === TelemetryEventName.SCAN_ACTION_SHIPMENT_SUBMITTED
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScanShipmentClient — FedEx label generation telemetry (spec §23)", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    mockShipCaseFn.mockClear();
    // Reset the implementation to the success path before each test
    mockShipCaseImpl = makeShipCaseMockSuccess();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ─── Basic emission ───────────────────────────────────────────────────────

  describe("basic event emission", () => {
    it("emits SCAN_ACTION_SHIPMENT_SUBMITTED on successful shipment recording", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].eventName).toBe(
        TelemetryEventName.SCAN_ACTION_SHIPMENT_SUBMITTED
      );
    });

    it("emits exactly one event per successful submission (no duplicates)", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      // Brief settle to confirm no duplicate fires
      await new Promise((r) => setTimeout(r, 50));
      expect(getShipmentSubmittedCalls()).toHaveLength(1);
    });
  });

  // ─── Event shape invariants ───────────────────────────────────────────────

  describe("event shape invariants", () => {
    it("sets eventCategory = 'user_action'", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].eventCategory).toBe("user_action");
    });

    it("sets app = 'scan'", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].app).toBe("scan");
    });
  });

  // ─── caseId field ─────────────────────────────────────────────────────────

  describe("caseId field", () => {
    it("includes the caseId prop in the telemetry event", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].caseId).toBe(CASE_ID);
    });
  });

  // ─── success field ────────────────────────────────────────────────────────

  describe("success field", () => {
    it("sets success = true on successful mutation", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].success).toBe(true);
    });
  });

  // ─── carrier field ────────────────────────────────────────────────────────

  describe("carrier field", () => {
    it("sets carrier = 'FedEx'", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].carrier).toBe("FedEx");
    });
  });

  // ─── trackingNumber field (spec §23) ─────────────────────────────────────

  describe("trackingNumber field (spec §23)", () => {
    it("includes the tracking number entered by the technician", async () => {
      setupAndRender();

      await fillAndSubmit(TRACKING_NUM);

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].trackingNumber).toBe(TRACKING_NUM);
    });

    it("trims leading/trailing whitespace from the tracking number", async () => {
      setupAndRender();

      await fillAndSubmit(`  ${TRACKING_NUM}  `);

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].trackingNumber).toBe(TRACKING_NUM);
    });

    it("records the full 22-digit tracking number without truncation", async () => {
      const longTrackingNum = "1234567890123456789012"; // 22 digits
      setupAndRender();

      await fillAndSubmit(longTrackingNum);

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].trackingNumber).toBe(longTrackingNum);
    });
  });

  // ─── initiatingUserId field (spec §23) ───────────────────────────────────

  describe("initiatingUserId field (spec §23)", () => {
    it("includes the initiating user ID in the event", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0].initiatingUserId).toBe(
        INITIATING_UID
      );
    });
  });

  // ─── No telemetry on failure ───────────────────────────────────────────────

  describe("no telemetry on failure paths", () => {
    it("does NOT emit SCAN_ACTION_SHIPMENT_SUBMITTED when the mutation rejects", async () => {
      setupAndRender({ shipMock: makeShipCaseMockFailure() });

      await fillAndSubmit();

      // Wait for the async rejection to settle
      await new Promise((r) => setTimeout(r, 150));

      expect(getShipmentSubmittedCalls()).toHaveLength(0);
    });
  });

  // ─── No telemetry on empty submit ─────────────────────────────────────────

  describe("no telemetry when form cannot submit", () => {
    it("does NOT emit an event when the tracking number input is empty", async () => {
      setupAndRender();

      // Submit button is disabled when the field is empty — click does nothing
      const submitBtn = screen.getByRole("button", { name: /Record Shipment/i });
      expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(submitBtn);

      await new Promise((r) => setTimeout(r, 50));

      expect(getShipmentSubmittedCalls()).toHaveLength(0);
    });
  });

  // ─── Complete event shape ─────────────────────────────────────────────────

  describe("complete event shape (spec §23)", () => {
    it("emits a fully-formed SCAN_ACTION_SHIPMENT_SUBMITTED event on happy path", async () => {
      setupAndRender();

      await fillAndSubmit(TRACKING_NUM);

      await waitFor(() => {
        expect(getShipmentSubmittedCalls()).toHaveLength(1);
      });

      expect(getShipmentSubmittedCalls()[0]).toMatchObject({
        eventCategory:    "user_action",
        eventName:        TelemetryEventName.SCAN_ACTION_SHIPMENT_SUBMITTED,
        app:              "scan",
        caseId:           CASE_ID,
        success:          true,
        carrier:          "FedEx",
        trackingNumber:   TRACKING_NUM,
        initiatingUserId: INITIATING_UID,
      });
    });
  });
});
