// @vitest-environment jsdom

/**
 * Unit tests: QR scan telemetry instrumentation in AssociateQRClient.
 *
 * Verifies that the correct telemetry events are emitted at each stage of the
 * QR scan-to-associate flow per spec section 23:
 *
 *   • SCAN_ACTION_QR_SCANNED  — successful camera or manual entry scan
 *   • ERROR_CAMERA_DENIED     — browser denied camera permission
 *   • ERROR_QR_SCAN_FAILED    — camera or BarcodeDetector unavailable
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked so we can assert on emitted events without a
 *   real transport or Convex backend.
 * • `convex/react` (useQuery, useMutation) are mocked to return a controlled
 *   case document so the component renders fully.
 * • `BarcodeDetector` and `navigator.mediaDevices.getUserMedia` are stubbed
 *   per-test to drive the camera scanning path.
 * • Tests use @testing-library/react `waitFor` to account for async camera
 *   initialisation that happens in useEffect.
 *
 * jsdom camera API notes
 * ─────────────────────
 * jsdom does not implement getUserMedia, BarcodeDetector, or real video
 * element playback.  Camera-path tests therefore:
 *   • Stub `window.BarcodeDetector` with a proper class constructor.
 *   • Stub `navigator.mediaDevices` via Object.defineProperty (jsdom's
 *     navigator is configurable).
 *   • Mock `HTMLVideoElement.prototype.play` to resolve immediately.
 *   • Set `HTMLVideoElement.prototype.readyState` to 4 (HAVE_ENOUGH_DATA)
 *     so the scanning loop can call detect() rather than re-queuing rAF.
 *
 * Covered scenarios
 * ─────────────────
 * 1.  Manual entry — SCAN_ACTION_QR_SCANNED with method="manual_entry"
 * 2.  Manual entry — qrPayload is included
 * 3.  Manual entry — scanDurationMs is null
 * 4.  Manual entry — qrPayload truncated to ≤ 256 chars
 * 5.  Manual entry — caseId matches component prop
 * 6.  BarcodeDetector unavailable — ERROR_QR_SCAN_FAILED emitted
 * 7.  BarcodeDetector unavailable — attemptDurationMs is a number
 * 8.  BarcodeDetector unavailable — ERROR_CAMERA_DENIED NOT emitted
 * 9.  Camera permission denied — ERROR_CAMERA_DENIED emitted
 * 10. Camera permission denied — permissionName="camera", recoverable=true
 * 11. Camera permission denied — ERROR_QR_SCAN_FAILED NOT emitted
 * 12. Camera permission denied — errorMessage truncated to ≤ 512 chars
 * 13. Camera scan success — SCAN_ACTION_QR_SCANNED with method="camera"
 * 14. Camera scan success — scanDurationMs is non-null and ≥ 0
 * 15. Camera scan success — qrPayload included
 * 16. Event shape — SCAN_ACTION_QR_SCANNED eventCategory = "user_action"
 * 17. Event shape — error events have eventCategory = "error"
 */

import React from "react";
import { render, waitFor, fireEvent, screen, cleanup } from "@testing-library/react";
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

// ─── Mock convex/react (control useQuery / useMutation without a server) ──────

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

// ─── Mock the Convex generated API (query/mutation identifiers) ───────────────

vi.mock("../../../../../../convex/_generated/api", () => ({
  api: {
    cases: {
      getCaseById:     "cases:getCaseById",
      getCaseByQrCode: "cases:getCaseByQrCode",
    },
    qrCodes: {
      associateQRCodeToCase: "qrCodes:associateQRCodeToCase",
    },
  },
}));

// ─── Mock CSS modules ─────────────────────────────────────────────────────────

vi.mock("./page.module.css", () => ({ default: {} }));

// ─── Import SUT (after all mocks are registered) ─────────────────────────────

import { useQuery, useMutation } from "convex/react";
import { AssociateQRClient } from "../AssociateQRClient";

// ─── Fixture: minimal case document ──────────────────────────────────────────

const CASE_ID = "case_telemetry_test_001";

const MOCK_CASE_DOC = {
  _id:          CASE_ID,
  label:        "CASE-aabbccdd11223344",
  status:       "assembled",
  qrCode:       "",
  locationName: "Denver HQ",
  assigneeName: "Test Tech",
  updatedAt:    1_700_000_000_000,
  notes:        null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Configure convex/react mocks before rendering. */
function setupConvexMocks(caseDoc = MOCK_CASE_DOC) {
  const mockAssociateMutation = vi.fn().mockResolvedValue({ wasAlreadyMapped: false });

  (useQuery as ReturnType<typeof vi.fn>).mockImplementation(
    (queryFn: unknown) => {
      if (queryFn === "cases:getCaseById")     return caseDoc;
      if (queryFn === "cases:getCaseByQrCode") return null;
      return null;
    }
  );
  (useMutation as ReturnType<typeof vi.fn>).mockReturnValue(mockAssociateMutation);

  return { mockAssociateMutation };
}

/**
 * Ensure BarcodeDetector is absent from window (forces camera→manual fallback).
 * Safe to call multiple times.
 */
function removeBarcodeDetector() {
  delete (window as unknown as Record<string, unknown>).BarcodeDetector;
}

/**
 * Install a BarcodeDetector class stub on window.
 * Uses a real class so `new BarcodeDetector()` constructs a proper instance.
 *
 * @param detectFn  The stub to use for instance.detect().  Defaults to returning [].
 */
function installBarcodeDetector(
  detectFn = vi.fn().mockResolvedValue([])
): typeof detectFn {
  class MockBarcodeDetector {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_opts?: { formats: string[] }) {}
    detect = detectFn;
  }
  (window as unknown as Record<string, unknown>).BarcodeDetector = MockBarcodeDetector;
  return detectFn;
}

/**
 * Override navigator.mediaDevices.getUserMedia via Object.defineProperty.
 * Returns the mock getUserMedia function for assertion convenience.
 */
function stubGetUserMedia(
  impl: () => Promise<MediaStream | never>
): ReturnType<typeof vi.fn> {
  const mockGetUserMedia = vi.fn().mockImplementation(impl);
  Object.defineProperty(window.navigator, "mediaDevices", {
    writable:     true,
    configurable: true,
    value: { getUserMedia: mockGetUserMedia },
  });
  return mockGetUserMedia;
}

/** Mock HTMLVideoElement.prototype.play to resolve immediately. */
function mockVideoPlay() {
  HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
}

/**
 * Override HTMLVideoElement.prototype.readyState so the scan loop can
 * proceed to call detect() rather than looping indefinitely in rAF.
 */
function setVideoReadyState(state: number) {
  Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
    get: () => state,
    configurable: true,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AssociateQRClient — QR scan telemetry (spec §23)", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    setupConvexMocks();
    // Start each test with no BarcodeDetector so camera-less tests get
    // a consistent baseline (QrCameraScanner auto-falls back to manual).
    removeBarcodeDetector();
  });

  afterEach(() => {
    cleanup(); // unmount all rendered components
    vi.clearAllMocks();
    removeBarcodeDetector();
    // Restore video prototype overrides
    delete (HTMLVideoElement.prototype as Partial<typeof HTMLVideoElement.prototype>).play;
    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      get: () => 0, // HAVE_NOTHING — safe default
      configurable: true,
    });
  });

  // ─── Helper: ensure the component has switched to manual-entry mode ─────────

  async function waitForManualTextarea(timeout = 2000) {
    await waitFor(
      () => expect(screen.queryByRole("textbox")).not.toBeNull(),
      { timeout }
    );
    return screen.getByRole("textbox");
  }

  // ─── Manual entry telemetry ───────────────────────────────────────────────

  describe("manual entry", () => {
    it("emits SCAN_ACTION_QR_SCANNED with method='manual_entry' on submit", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);

      // BarcodeDetector unavailable → component auto-switches to manual
      const textarea = await waitForManualTextarea();
      fireEvent.change(textarea, {
        target: { value: "https://scan.skyspecs.com/case/case_abc?uid=deadbeef01234567" },
      });
      fireEvent.click(screen.getByRole("button", { name: /use this code/i }));

      const qrScannedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);

      expect(qrScannedCalls).toHaveLength(1);
      expect(qrScannedCalls[0]).toMatchObject({
        eventCategory: "user_action",
        eventName:     TelemetryEventName.SCAN_ACTION_QR_SCANNED,
        app:           "scan",
        caseId:        CASE_ID,
        success:       true,
        method:        "manual_entry",
      });
    });

    it("emits scanDurationMs=null for manual entry", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);
      const textarea = await waitForManualTextarea();
      fireEvent.change(textarea, { target: { value: "QR_CODE_PAYLOAD" } });
      fireEvent.click(screen.getByRole("button", { name: /use this code/i }));

      const qrScannedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);

      expect(qrScannedCalls).toHaveLength(1);
      expect(qrScannedCalls[0].scanDurationMs).toBeNull();
    });

    it("includes qrPayload in the emitted event", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);
      const textarea = await waitForManualTextarea();

      const payload = "https://scan.example.com/case/abc?uid=1234";
      fireEvent.change(textarea, { target: { value: payload } });
      fireEvent.click(screen.getByRole("button", { name: /use this code/i }));

      const qrScannedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);

      expect(qrScannedCalls[0].qrPayload).toBe(payload);
    });

    it("truncates qrPayload to 256 chars when QR value exceeds that", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);
      const textarea = await waitForManualTextarea();

      const longPayload = "A".repeat(300);
      fireEvent.change(textarea, { target: { value: longPayload } });
      fireEvent.click(screen.getByRole("button", { name: /use this code/i }));

      const qrScannedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);

      expect((qrScannedCalls[0].qrPayload as string).length).toBe(256);
    });

    it("emits caseId matching the component prop", async () => {
      const specificCaseId = "case_specific_id_xyz";
      setupConvexMocks({ ...MOCK_CASE_DOC, _id: specificCaseId });

      render(<AssociateQRClient caseId={specificCaseId} />);
      const textarea = await waitForManualTextarea();

      fireEvent.change(textarea, { target: { value: "PAYLOAD_FOR_CASE" } });
      fireEvent.click(screen.getByRole("button", { name: /use this code/i }));

      const qrScannedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);

      expect(qrScannedCalls[0].caseId).toBe(specificCaseId);
    });
  });

  // ─── Camera API unavailable (BarcodeDetector not supported) ──────────────

  describe("camera — BarcodeDetector unavailable", () => {
    // BarcodeDetector is already absent in the outer beforeEach

    it("emits ERROR_QR_SCAN_FAILED when BarcodeDetector is not supported", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);

      await waitFor(() => {
        const errorCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) => e.eventName === TelemetryEventName.ERROR_QR_SCAN_FAILED);
        expect(errorCalls.length).toBeGreaterThan(0);
      }, { timeout: 2000 });

      const errorCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.ERROR_QR_SCAN_FAILED);

      expect(errorCalls[0]).toMatchObject({
        eventCategory: "error",
        eventName:     TelemetryEventName.ERROR_QR_SCAN_FAILED,
        app:           "scan",
        caseId:        CASE_ID,
        errorCode:     "CAMERA_UNAVAILABLE",
        recoverable:   true,
      });
    });

    it("includes attemptDurationMs as a non-negative number", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);

      await waitFor(() => {
        const errorCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) => e.eventName === TelemetryEventName.ERROR_QR_SCAN_FAILED);
        expect(errorCalls.length).toBeGreaterThan(0);
      }, { timeout: 2000 });

      const errorCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.ERROR_QR_SCAN_FAILED);

      expect(typeof errorCalls[0].attemptDurationMs).toBe("number");
      expect(errorCalls[0].attemptDurationMs as number).toBeGreaterThanOrEqual(0);
    });

    it("does NOT emit ERROR_CAMERA_DENIED for BarcodeDetector unavailability", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);

      await waitFor(() => {
        const errorCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) => e.eventName === TelemetryEventName.ERROR_QR_SCAN_FAILED);
        expect(errorCalls.length).toBeGreaterThan(0);
      }, { timeout: 2000 });

      const deniedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.ERROR_CAMERA_DENIED);

      expect(deniedCalls).toHaveLength(0);
    });
  });

  // ─── Camera permission denied ─────────────────────────────────────────────

  describe("camera — permission denied", () => {
    beforeEach(() => {
      // Install a proper BarcodeDetector class so the init code proceeds past
      // the feature-detect to the getUserMedia call.
      installBarcodeDetector();

      // Stub getUserMedia to reject with a NotAllowedError DOMException —
      // the same error shape a real browser returns when the user denies permission.
      stubGetUserMedia(() =>
        Promise.reject(new DOMException("Permission denied.", "NotAllowedError"))
      );
    });

    it("emits ERROR_CAMERA_DENIED with correct fields when camera is denied", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);

      await waitFor(() => {
        const deniedCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) => e.eventName === TelemetryEventName.ERROR_CAMERA_DENIED);
        expect(deniedCalls.length).toBeGreaterThan(0);
      }, { timeout: 3000 });

      const deniedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.ERROR_CAMERA_DENIED);

      expect(deniedCalls[0]).toMatchObject({
        eventCategory:  "error",
        eventName:      TelemetryEventName.ERROR_CAMERA_DENIED,
        app:            "scan",
        caseId:         CASE_ID,
        errorCode:      "CAMERA_PERMISSION_DENIED",
        recoverable:    true,
        permissionName: "camera",
      });
    });

    it("does NOT emit ERROR_QR_SCAN_FAILED for permission denial", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);

      await waitFor(() => {
        const deniedCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) => e.eventName === TelemetryEventName.ERROR_CAMERA_DENIED);
        expect(deniedCalls.length).toBeGreaterThan(0);
      }, { timeout: 3000 });

      const scanFailedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.ERROR_QR_SCAN_FAILED);

      expect(scanFailedCalls).toHaveLength(0);
    });

    it("truncates errorMessage to ≤ 512 chars for very long messages", async () => {
      // Override with a long permission-denied message
      stubGetUserMedia(() =>
        Promise.reject(
          new DOMException(
            "Camera access denied. " + "X".repeat(600),
            "NotAllowedError"
          )
        )
      );

      render(<AssociateQRClient caseId={CASE_ID} />);

      await waitFor(() => {
        const deniedCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) => e.eventName === TelemetryEventName.ERROR_CAMERA_DENIED);
        expect(deniedCalls.length).toBeGreaterThan(0);
      }, { timeout: 3000 });

      const deniedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.ERROR_CAMERA_DENIED);

      expect((deniedCalls[0].errorMessage as string).length).toBeLessThanOrEqual(512);
    });
  });

  // ─── Camera scan success ──────────────────────────────────────────────────

  describe("camera scan success", () => {
    let mockDetect: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Set up BarcodeDetector with a detect stub that initially returns [] but
      // the test can override via mockDetect.
      mockDetect = vi.fn().mockResolvedValue([]);
      installBarcodeDetector(mockDetect);

      // Stub getUserMedia to return a mock stream
      const mockStream = {
        getTracks: () => [{ stop: vi.fn() }],
      } as unknown as MediaStream;
      stubGetUserMedia(() => Promise.resolve(mockStream));

      // HTMLVideoElement.play() must resolve; otherwise setCameraReady is never called
      mockVideoPlay();

      // readyState = 4 (HAVE_ENOUGH_DATA) so the scan loop calls detect() directly
      // rather than looping indefinitely in requestAnimationFrame.
      setVideoReadyState(4);
    });

    it("emits SCAN_ACTION_QR_SCANNED with method='camera' when a QR is detected", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);

      // Wait for the camera viewfinder to be shown (camera is ready)
      await waitFor(() => {
        expect(screen.queryByLabelText(/camera viewfinder/i)).not.toBeNull();
      }, { timeout: 3000 });

      // Make the detector return a QR code on the next detect() call
      mockDetect.mockResolvedValue([
        { rawValue: "https://scan.example.com/case/abc?uid=deadbeef01234567", format: "qr_code" },
      ]);

      // Wait for the telemetry event — the scan loop calls detect() via rAF
      await waitFor(() => {
        const qrScannedCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);
        expect(qrScannedCalls.length).toBeGreaterThan(0);
      }, { timeout: 5000 });

      const qrScannedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);

      expect(qrScannedCalls[0]).toMatchObject({
        eventCategory: "user_action",
        eventName:     TelemetryEventName.SCAN_ACTION_QR_SCANNED,
        app:           "scan",
        caseId:        CASE_ID,
        success:       true,
        method:        "camera",
      });
    });

    it("includes non-null scanDurationMs for camera scans", async () => {
      render(<AssociateQRClient caseId={CASE_ID} />);

      await waitFor(() => {
        expect(screen.queryByLabelText(/camera viewfinder/i)).not.toBeNull();
      }, { timeout: 3000 });

      mockDetect.mockResolvedValue([
        { rawValue: "SCAN_PAYLOAD_CAMERA", format: "qr_code" },
      ]);

      await waitFor(() => {
        const qrScannedCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);
        expect(qrScannedCalls.length).toBeGreaterThan(0);
      }, { timeout: 5000 });

      const qrScannedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);

      // Camera scan: scanDurationMs must be a non-negative number (not null)
      expect(qrScannedCalls[0].scanDurationMs).not.toBeNull();
      expect(typeof qrScannedCalls[0].scanDurationMs).toBe("number");
      expect(qrScannedCalls[0].scanDurationMs as number).toBeGreaterThanOrEqual(0);
    });

    it("includes qrPayload in the camera scan event", async () => {
      const expectedPayload = "https://scan.example.com/case/abc?uid=deadbeef01234567";

      render(<AssociateQRClient caseId={CASE_ID} />);

      await waitFor(() => {
        expect(screen.queryByLabelText(/camera viewfinder/i)).not.toBeNull();
      }, { timeout: 3000 });

      mockDetect.mockResolvedValue([
        { rawValue: expectedPayload, format: "qr_code" },
      ]);

      await waitFor(() => {
        const qrScannedCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);
        expect(qrScannedCalls.length).toBeGreaterThan(0);
      }, { timeout: 5000 });

      const qrScannedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);

      expect(qrScannedCalls[0].qrPayload).toBe(expectedPayload);
    });
  });

  // ─── Event shape invariants ───────────────────────────────────────────────

  describe("event shape invariants", () => {
    it("SCAN_ACTION_QR_SCANNED has eventCategory='user_action' (via manual entry)", async () => {
      // This test explicitly uses the manual-entry path to guarantee reliable
      // assertion without any camera API dependencies.
      render(<AssociateQRClient caseId={CASE_ID} />);

      const textarea = await waitForManualTextarea(2000);
      fireEvent.change(textarea, { target: { value: "INVARIANT_TEST_PAYLOAD" } });
      fireEvent.click(screen.getByRole("button", { name: /use this code/i }));

      const qrScannedCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_QR_SCANNED);

      expect(qrScannedCalls.length).toBeGreaterThan(0);
      for (const event of qrScannedCalls) {
        expect(event.eventCategory).toBe("user_action");
        expect(event.app).toBe("scan");
      }
    });

    it("error events from camera unavailability have eventCategory='error'", async () => {
      // BarcodeDetector not present → ERROR_QR_SCAN_FAILED
      render(<AssociateQRClient caseId={CASE_ID} />);

      await waitFor(() => {
        const errorCalls = mockTrackEvent.mock.calls
          .map((args: unknown[]) => args[0] as Record<string, unknown>)
          .filter((e) =>
            e.eventName === TelemetryEventName.ERROR_QR_SCAN_FAILED ||
            e.eventName === TelemetryEventName.ERROR_CAMERA_DENIED
          );
        expect(errorCalls.length).toBeGreaterThan(0);
      }, { timeout: 2000 });

      const errorCalls = mockTrackEvent.mock.calls
        .map((args: unknown[]) => args[0] as Record<string, unknown>)
        .filter((e) =>
          e.eventName === TelemetryEventName.ERROR_QR_SCAN_FAILED ||
          e.eventName === TelemetryEventName.ERROR_CAMERA_DENIED
        );

      for (const event of errorCalls) {
        expect(event.eventCategory).toBe("error");
        expect(event.app).toBe("scan");
      }
    });
  });
});
