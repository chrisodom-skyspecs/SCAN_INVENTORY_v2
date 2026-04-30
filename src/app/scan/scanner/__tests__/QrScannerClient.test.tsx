// @vitest-environment jsdom

/**
 * Unit tests: QrScannerClient — AC 240101 Sub-AC 1 + AC 240203 Sub-AC 3
 *
 * Verifies the QR scanner UI screen behaviour including:
 *
 * Sub-AC 1 (camera + display):
 *   - Shows 'Scan QR Code' heading in scanning phase
 *   - Falls back to manual entry when BarcodeDetector is unavailable
 *   - Falls back to manual entry when camera access is denied
 *   - Displays the raw scanned value when a QR code is detected (manual path)
 *   - Extracts a case ID from a plain string QR value
 *   - Extracts a case ID from a URL-format QR value
 *   - Renders the "Scan Again" button after detection
 *   - Changes heading to "QR Code Detected" after detection
 *   - Shows "Looking up case…" spinner while Convex resolves
 *
 * Sub-AC 3 (Convex lookup + routing):
 *   - Shows resolving spinner while Convex lookup is in-flight (undefined)
 *   - Shows "QR code not recognised" error when lookup returns null
 *   - Renders the "Open Case" CTA when case is found (lookupState === "found")
 *   - Auto-navigates to /scan/{caseDoc._id} when lookup resolves successfully
 *   - Navigates to the Convex document ID (not the extracted display string)
 *   - Navigating via "Open Case" button uses the Convex document ID
 *   - Resets Convex subscription when "Scan Again" is clicked
 *   - Shows case label in the found state
 *
 * jsdom notes
 * ───────────
 * - BarcodeDetector is stubbed as `undefined` (unsupported) or a proper class.
 * - getUserMedia is stubbed via Object.defineProperty.
 * - HTMLVideoElement.play() resolves immediately.
 * - useScanCaseByQrIdentifier is mocked at the module level to control
 *   lookup results without a real Convex connection.
 * - No fake timers — waitFor relies on real setTimeout polling.
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * useScanCaseByQrIdentifier mock.
 *
 * The default export returns `undefined` (loading/skip state) so tests that
 * don't override it see the "resolving" spinner.
 *
 * Individual tests call `mockUseScanCaseByQrIdentifier.mockReturnValue(…)` to
 * control the lookup result:
 *   undefined  → query in-flight (resolving spinner)
 *   null       → not found (error state)
 *   caseDoc    → found (open-case button + auto-navigate)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseScanCaseByQrIdentifier = vi.fn((_identifier: string | null): any => undefined);

vi.mock("../../../../hooks/use-scan-queries", () => ({
  useScanCaseByQrIdentifier: (identifier: string | null) =>
    mockUseScanCaseByQrIdentifier(identifier),
}));

/**
 * useRecordScanEvent mock — Sub-AC 1 of AC 350201.
 *
 * The QrScannerClient invokes this mutation immediately after a QR code
 * resolves to a case (lookupState === "found"). Tests assert that:
 *   - It is called with the caseId, raw qrPayload, scannedBy, scannedByName,
 *     a numeric scannedAt, and scanContext "lookup".
 *   - It is NOT called while the lookup is still resolving or when the lookup
 *     returns null (unrecognised QR code).
 *   - It is called once per scan — repeated re-renders within a single
 *     resolution must not double-write the immutable scan history.
 */
const mockRecordScanEvent = vi.fn().mockResolvedValue({
  scanId:    "scan_test_001",
  caseId:    "jx7a2b3c4d5e6f7g",
  scannedAt: 1700000000000,
});

vi.mock("../../../../hooks/use-scan-mutations", () => ({
  useRecordScanEvent: () => mockRecordScanEvent,
}));

/**
 * useCurrentUser mock — provides the Kinde identity that recordScanEvent
 * requires for attribution (scannedBy + scannedByName).
 *
 * Default: returns a fully-loaded technician identity.  Individual tests can
 * mock this differently (e.g., isLoading: true) via mockUseCurrentUser.mockReturnValue.
 *
 * Typed with the `CurrentUserState` interface (loosened return shape) so that
 * test cases overriding the default (e.g., loading state with isTechnician: false)
 * compile cleanly.
 */
import type { CurrentUserState } from "../../../../hooks/use-current-user";

const mockUseCurrentUser = vi.fn<() => CurrentUserState>(() => ({
  id:           "test-user-id",
  name:         "Test Technician",
  roles:        ["technician"],
  primaryRole:  "technician",
  isAdmin:      false,
  isTechnician: true,
  isPilot:      false,
  isLoading:    false,
  isAuthenticated: true,
  can:          () => true,
}));

vi.mock("../../../../hooks/use-current-user", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

import { QrScannerClient } from "../QrScannerClient";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Remove BarcodeDetector from window (simulate unsupported browser). */
function removeBarcodeDetector() {
  Object.defineProperty(window, "BarcodeDetector", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

/**
 * Install a BarcodeDetector class that:
 * - Instantiates successfully (class syntax → no "not a constructor" error)
 * - Returns `detectedQR` from the first detect() call, then empty arrays
 */
function installBarcodeDetector(detectedQR: string | null = null) {
  let callCount = 0;
  const mockDetect = vi.fn(async () => {
    callCount++;
    if (detectedQR !== null && callCount === 1) {
      return [{ rawValue: detectedQR, format: "qr_code" }];
    }
    return [];
  });

  // Must use class syntax so `new BarcodeDetector()` works in jsdom
  class MockBarcodeDetectorClass {
    detect = mockDetect;
  }

  Object.defineProperty(window, "BarcodeDetector", {
    value: MockBarcodeDetectorClass,
    writable: true,
    configurable: true,
  });

  return { mockDetect };
}

/**
 * Stub getUserMedia.
 * `options.reject` — if provided, getUserMedia rejects with this error.
 */
function installGetUserMedia(options: { reject?: DOMException } = {}) {
  const mockGetUserMedia = vi.fn(async () => {
    if (options.reject) throw options.reject;
    return {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
  });

  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
    configurable: true,
  });

  // jsdom doesn't implement video.play() — make it resolve immediately
  Object.defineProperty(HTMLVideoElement.prototype, "play", {
    value: vi.fn().mockResolvedValue(undefined),
    writable: true,
    configurable: true,
  });

  return { mockGetUserMedia };
}

/**
 * Fill the manual textarea and submit the form.
 * Assumes the component is already in "manual" phase.
 */
async function submitManualQR(value: string) {
  const user = userEvent.setup();
  const textarea = await screen.findByTestId("manual-qr-input");
  await user.type(textarea, value);
  const submitBtn = await screen.findByTestId("manual-qr-submit");
  await user.click(submitBtn);
}

/** Minimal mock case document returned from Convex lookup. */
const MOCK_CASE_DOC = {
  _id: "jx7a2b3c4d5e6f7g" as unknown as import("../../../../../convex/_generated/dataModel").Id<"cases">,
  _creationTime: 1700000000000,
  label: "CASE-007",
  qrCode: "https://scan.skyspecsops.com/case/jx7a2b3c4d5e6f7g?uid=abc123&source=generated",
  status: "hangar" as const,
  updatedAt: 1700000000000,
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("QrScannerClient", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseScanCaseByQrIdentifier.mockReset();
    // Default: lookup returns undefined (loading/skip) — shows resolving spinner
    mockUseScanCaseByQrIdentifier.mockReturnValue(undefined);
    // Reset the recordScanEvent mock so per-test assertions are clean
    mockRecordScanEvent.mockClear();
    mockRecordScanEvent.mockResolvedValue({
      scanId:    "scan_test_001",
      caseId:    "jx7a2b3c4d5e6f7g",
      scannedAt: 1700000000000,
    });
    // Reset the current-user mock to the default fully-loaded technician
    mockUseCurrentUser.mockReset();
    mockUseCurrentUser.mockReturnValue({
      id:           "test-user-id",
      name:         "Test Technician",
      roles:        ["technician"],
      primaryRole:  "technician",
      isAdmin:      false,
      isTechnician: true,
      isPilot:      false,
      isLoading:    false,
      isAuthenticated: true,
      can:          () => true,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ── 1. Page heading ─────────────────────────────────────────────────────────

  it("1. renders the 'Scan QR Code' heading in the initial scanning phase", () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    expect(
      screen.getByRole("heading", { name: /Scan QR Code/i })
    ).toBeDefined();
  });

  // ── 2. BarcodeDetector unavailable ─────────────────────────────────────────

  it("2. shows manual entry form when BarcodeDetector is unavailable", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await waitFor(() => {
      expect(screen.getByTestId("manual-qr-input")).toBeDefined();
    });
  });

  it("3. shows 'QR scanning is not supported' message when BarcodeDetector is missing", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await waitFor(() => {
      expect(
        screen.getByText(/QR scanning is not supported/i)
      ).toBeDefined();
    });
  });

  it("4. shows 'Camera' toggle button in manual phase", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Switch to camera scanner/i })
      ).toBeDefined();
    });
  });

  it("5. shows manual submit button (Decode QR Code) in manual phase", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Decode QR Code/i })
      ).toBeDefined();
    });
  });

  // ── 3. BarcodeDetector constructor fails ────────────────────────────────────

  it("6. falls back to manual when BarcodeDetector instantiation fails", async () => {
    class ThrowingDetector {
      constructor() {
        throw new Error("init failed");
      }
    }
    Object.defineProperty(window, "BarcodeDetector", {
      value: ThrowingDetector,
      writable: true,
      configurable: true,
    });
    render(<QrScannerClient />);
    await waitFor(() => {
      expect(screen.getByTestId("manual-qr-input")).toBeDefined();
    });
  });

  // ── 4. Camera permission denied ─────────────────────────────────────────────

  it("7. falls back to manual entry when camera permission is denied", async () => {
    installBarcodeDetector(null);
    const denied = new DOMException("Permission denied", "NotAllowedError");
    installGetUserMedia({ reject: denied });
    render(<QrScannerClient />);
    await waitFor(() => {
      expect(screen.getByTestId("manual-qr-input")).toBeDefined();
    });
  });

  it("8. shows 'Camera access denied' message when permission is rejected", async () => {
    installBarcodeDetector(null);
    const denied = new DOMException("Permission denied", "NotAllowedError");
    installGetUserMedia({ reject: denied });
    render(<QrScannerClient />);
    await waitFor(() => {
      expect(
        screen.getByText(/Camera access denied/i)
      ).toBeDefined();
    });
  });

  // ── 5. Manual form submission ────────────────────────────────────────────────

  it("9. manual submit button is disabled when textarea is empty", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    const submitBtn = await screen.findByTestId("manual-qr-submit");
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("10. manual submit button is enabled when textarea has a value", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    const textarea = await screen.findByTestId("manual-qr-input");
    const submitBtn = await screen.findByTestId("manual-qr-submit");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "CASE-001" } });
    });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("11. shows the detected card after manual submission", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("CASE-001");
    await waitFor(() => {
      expect(screen.getByTestId("qr-detected-card")).toBeDefined();
    });
  });

  // ── 6. Raw value display ─────────────────────────────────────────────────────

  it("12. displays the exact raw scanned value in the detected card", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      const el = screen.getByTestId("qr-raw-value");
      expect(el.textContent).toBe("CASE-007");
    });
  });

  it("13. heading changes to 'QR Code Detected' after detection", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /QR Code Detected/i })
      ).toBeDefined();
    });
  });

  // ── 7. Case ID extraction (display only) ────────────────────────────────────

  it("14. extracts a case ID from a plain string QR value", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      const el = screen.getByTestId("qr-case-id");
      expect(el.textContent).toBe("CASE-007");
    });
  });

  it("15. extracts a case ID from a /scan/<id> URL QR value", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("https://scan.skyspecsops.com/scan/CASE-42");
    await waitFor(() => {
      const el = screen.getByTestId("qr-case-id");
      expect(el.textContent).toBe("CASE-42");
    });
  });

  it("16. extracts a case ID from a /case/<id> URL QR value", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("https://inventory.skyspecsops.com/case/SKY-2025-001");
    await waitFor(() => {
      const el = screen.getByTestId("qr-case-id");
      expect(el.textContent).toBe("SKY-2025-001");
    });
  });

  // ── 8. Convex lookup states (Sub-AC 3) ──────────────────────────────────────

  it("17. shows resolving spinner while Convex lookup is in-flight (undefined)", async () => {
    removeBarcodeDetector();
    // Default mock: returns undefined (lookup loading)
    mockUseScanCaseByQrIdentifier.mockReturnValue(undefined);
    render(<QrScannerClient />);
    await submitManualQR("CASE-001");
    await waitFor(() => {
      expect(screen.getByTestId("qr-lookup-resolving")).toBeDefined();
    });
  });

  it("18. shows 'QR code not recognised' error when lookup returns null", async () => {
    removeBarcodeDetector();
    // Mock: lookup returns null → not found
    mockUseScanCaseByQrIdentifier.mockReturnValue(null);
    render(<QrScannerClient />);
    await submitManualQR("UNRECOGNISED-CODE");
    await waitFor(() => {
      expect(screen.getByTestId("qr-lookup-not-found")).toBeDefined();
    });
    await waitFor(() => {
      expect(
        screen.getByText(/QR code not recognised in system/i)
      ).toBeDefined();
    });
  });

  it("19. renders the 'Open Case' CTA button when lookup resolves to a case", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      expect(screen.getByTestId("qr-open-case-btn")).toBeDefined();
    });
  });

  it("20. shows the found case label when lookup resolves", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      expect(screen.getByTestId("qr-found-case-label")).toBeDefined();
      expect(screen.getByTestId("qr-found-case-label").textContent).toBe("CASE-007");
    });
  });

  it("21. renders the 'Scan Again' button in the detected phase", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("CASE-001");
    await waitFor(() => {
      expect(screen.getByTestId("qr-scan-again-btn")).toBeDefined();
    });
  });

  // ── 9. Navigation (Sub-AC 3) ─────────────────────────────────────────────────

  it("22. auto-navigates to /scan/{caseDoc._id} when lookup resolves to a case", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        `/scan/${encodeURIComponent(MOCK_CASE_DOC._id)}`
      );
    });
  });

  it("23. navigates with the Convex document _id, not the extracted display string", async () => {
    removeBarcodeDetector();
    // The extracted display ID would be "CASE-007" but the _id is "jx7a2b3c4d5e6f7g"
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      // Should navigate to the Convex _id, NOT to "CASE-007"
      expect(mockPush).toHaveBeenCalledWith(
        `/scan/${encodeURIComponent("jx7a2b3c4d5e6f7g")}`
      );
      expect(mockPush).not.toHaveBeenCalledWith("/scan/CASE-007");
    });
  });

  it("24. clicking 'Open Case' button navigates using Convex document _id", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    const openBtn = await screen.findByTestId("qr-open-case-btn");
    await act(async () => {
      fireEvent.click(openBtn);
    });
    expect(mockPush).toHaveBeenCalledWith(
      `/scan/${encodeURIComponent(MOCK_CASE_DOC._id)}`
    );
  });

  it("25. does not navigate when lookup returns null (not found)", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(null);
    render(<QrScannerClient />);
    await submitManualQR("UNRECOGNISED-CODE");
    await waitFor(() => {
      expect(screen.getByTestId("qr-lookup-not-found")).toBeDefined();
    });
    // router.push should NOT have been called
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("26. does not navigate while lookup is still resolving (undefined)", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(undefined);
    render(<QrScannerClient />);
    await submitManualQR("CASE-001");
    await waitFor(() => {
      expect(screen.getByTestId("qr-lookup-resolving")).toBeDefined();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  // ── 10. Scan again flow ──────────────────────────────────────────────────────

  it("27. clicking 'Scan Again' returns to scanning/manual entry", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("CASE-001");
    const scanAgainBtn = await screen.findByTestId("qr-scan-again-btn");
    await act(async () => {
      fireEvent.click(scanAgainBtn);
    });
    // BarcodeDetector unavailable → transitions back to manual phase
    await waitFor(() => {
      expect(screen.getByTestId("manual-qr-input")).toBeDefined();
    });
  });

  it("28. clicking 'Scan Again' clears the detected card", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("CASE-001");
    // Verify detected card is visible first
    await waitFor(() => {
      expect(screen.getByTestId("qr-detected-card")).toBeDefined();
    });
    const scanAgainBtn = screen.getByTestId("qr-scan-again-btn");
    await act(async () => {
      fireEvent.click(scanAgainBtn);
    });
    // Detected card should be gone
    await waitFor(() => {
      expect(screen.queryByTestId("qr-detected-card")).toBeNull();
    });
  });

  // ── 11. Mode toggle ──────────────────────────────────────────────────────────

  it("29. clicking 'Camera' toggle switches from manual to scanning phase", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    // Wait for manual phase (BarcodeDetector unavailable)
    const cameraBtn = await screen.findByRole("button", {
      name: /Switch to camera scanner/i,
    });
    await act(async () => {
      fireEvent.click(cameraBtn);
    });
    // Phase is now "scanning" — heading reverts
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Scan QR Code/i })
      ).toBeDefined();
    });
  });

  // ── 12. Back link ────────────────────────────────────────────────────────────

  it("30. renders a 'Back to SCAN home' link at the bottom", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /Back to SCAN home/i });
      expect((link as HTMLAnchorElement).href).toContain("/scan");
    });
  });

  // ── 13. useScanCaseByQrIdentifier is called with raw value ──────────────────

  it("31. calls useScanCaseByQrIdentifier with the raw QR value after detection", async () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    await submitManualQR("https://scan.skyspecsops.com/case/jx7a2b3c4d5e6f7g?uid=abc");
    await waitFor(() => {
      // The mock should have been called with the raw value (trimmed)
      expect(mockUseScanCaseByQrIdentifier).toHaveBeenCalledWith(
        "https://scan.skyspecsops.com/case/jx7a2b3c4d5e6f7g?uid=abc"
      );
    });
  });

  it("32. calls useScanCaseByQrIdentifier with null initially (no subscription before scan)", () => {
    removeBarcodeDetector();
    render(<QrScannerClient />);
    // On mount, rawValue is null → hook called with null to skip subscription
    expect(mockUseScanCaseByQrIdentifier).toHaveBeenCalledWith(null);
  });

  // ── 14. recordScanEvent wiring (AC 350201 Sub-AC 1) ─────────────────────────
  // The SCAN case scan action handler must invoke the Convex mutation
  // `recordScanEvent` whenever a scanned QR code resolves to a case. This
  // writes an immutable row into the `scans` table, which invalidates the
  // by_case, by_case_scanned_at, by_user, and by_scanned_at reactive
  // subscriptions within the ≤ 2-second real-time fidelity window.

  it("33. invokes recordScanEvent with the resolved caseId and raw qrPayload", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      expect(mockRecordScanEvent).toHaveBeenCalledTimes(1);
    });
    const args = mockRecordScanEvent.mock.calls[0][0];
    expect(args.caseId).toBe(MOCK_CASE_DOC._id);
    expect(args.qrPayload).toBe("CASE-007");
  });

  it("34. attributes the scan to the current user (scannedBy + scannedByName)", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      expect(mockRecordScanEvent).toHaveBeenCalled();
    });
    const args = mockRecordScanEvent.mock.calls[0][0];
    expect(args.scannedBy).toBe("test-user-id");
    expect(args.scannedByName).toBe("Test Technician");
  });

  it("35. tags the scan with scanContext='lookup' for pre-workflow scans", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      expect(mockRecordScanEvent).toHaveBeenCalled();
    });
    const args = mockRecordScanEvent.mock.calls[0][0];
    expect(args.scanContext).toBe("lookup");
  });

  it("36. supplies a numeric scannedAt timestamp (epoch ms)", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      expect(mockRecordScanEvent).toHaveBeenCalled();
    });
    const args = mockRecordScanEvent.mock.calls[0][0];
    expect(typeof args.scannedAt).toBe("number");
    expect(args.scannedAt).toBeGreaterThan(0);
  });

  it("37. does NOT invoke recordScanEvent while lookup is still resolving (undefined)", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(undefined);
    render(<QrScannerClient />);
    await submitManualQR("CASE-001");
    // Resolving spinner is shown; mutation must NOT have fired
    await waitFor(() => {
      expect(screen.getByTestId("qr-lookup-resolving")).toBeDefined();
    });
    expect(mockRecordScanEvent).not.toHaveBeenCalled();
  });

  it("38. does NOT invoke recordScanEvent when lookup returns null (not found)", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(null);
    render(<QrScannerClient />);
    await submitManualQR("UNRECOGNISED-CODE");
    await waitFor(() => {
      expect(screen.getByTestId("qr-lookup-not-found")).toBeDefined();
    });
    // Unrecognised QR codes have no caseId to attach the scan row to
    expect(mockRecordScanEvent).not.toHaveBeenCalled();
  });

  it("39. records the scan only once per resolution (no double-write on re-render)", async () => {
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    const { rerender } = render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    await waitFor(() => {
      expect(mockRecordScanEvent).toHaveBeenCalledTimes(1);
    });
    // Force a few re-renders — the dedupe ref must prevent additional writes.
    rerender(<QrScannerClient />);
    rerender(<QrScannerClient />);
    expect(mockRecordScanEvent).toHaveBeenCalledTimes(1);
  });

  it("40. defers recordScanEvent until the current user identity has loaded", async () => {
    // Identity loading: useCurrentUser returns isLoading: true on first render.
    mockUseCurrentUser.mockReturnValue({
      id:           "",
      name:         "",
      roles:        [],
      primaryRole:  null,
      isAdmin:      false,
      isTechnician: false,
      isPilot:      false,
      isLoading:    true,
      isAuthenticated: false,
      can:          () => false,
    });
    removeBarcodeDetector();
    mockUseScanCaseByQrIdentifier.mockReturnValue(MOCK_CASE_DOC);
    render(<QrScannerClient />);
    await submitManualQR("CASE-007");
    // Detected card renders, but the mutation is deferred until identity loads.
    await waitFor(() => {
      expect(screen.getByTestId("qr-detected-card")).toBeDefined();
    });
    expect(mockRecordScanEvent).not.toHaveBeenCalled();
  });
});
