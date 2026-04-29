/**
 * LabelManagementPanel — unit tests.
 *
 * Tests that:
 *   - Panel renders with the correct initial mode (generate)
 *   - Mode tabs switch between generate and associate flows
 *   - Generate flow: idle state renders the Generate button
 *   - Generate flow: loading state renders spinner while mutation is in-flight
 *   - Generate flow: success state renders QR SVG and success banner
 *   - Generate flow: error state renders error banner with Retry button
 *   - Generate flow: force-regenerate checkbox is shown when hasExistingQrCode=true
 *   - Associate flow: form is rendered with input and submit button
 *   - Associate flow: submit button is disabled when input is empty
 *   - Associate flow: loading state renders spinner while mutation is in-flight
 *   - Associate flow: success state renders QR SVG and success banner
 *   - Associate flow: error state renders error banner with Try again button
 *   - Real-time validation badge is shown when validateQrCode returns a result
 *   - onGenerated callback is called after successful generation
 *   - onAssociated callback is called after successful association
 *
 * Mocking strategy:
 *   - `convex/react` useMutation and useQuery are vi.mock'd to control
 *     mutation behavior without a real Convex deployment.
 *   - `useKindeUser` is vi.mock'd with a fixed user ID and name.
 *   - `qrcode` is vi.mock'd to return a deterministic SVG string.
 *   - The Convex generated API module is vi.mock'd with empty stubs.
 *
 * @vitest-environment jsdom
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import * as React from "react";

// ─── Mock convex/react ────────────────────────────────────────────────────────

const mockMutationFn = vi.fn();
const mockQueryResult = vi.fn(() => undefined as unknown);

vi.mock("convex/react", () => ({
  useMutation: vi.fn(() => mockMutationFn),
  useQuery: vi.fn((_query: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    return mockQueryResult();
  }),
}));

// ─── Mock Convex generated API ────────────────────────────────────────────────

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    qrCodes: {
      generateQRCodeForCase: "generateQRCodeForCase",
      associateQRCodeToCase: "associateQRCodeToCase",
      validateQrCode:        "validateQrCode",
    },
  },
}));

vi.mock("../../../../convex/_generated/dataModel", () => ({
  Id: {},
}));

// ─── Mock useKindeUser ────────────────────────────────────────────────────────

vi.mock("@/hooks/use-kinde-user", () => ({
  useKindeUser: vi.fn(() => ({
    id:              "user-123",
    name:            "Jane Operator",
    isLoading:       false,
    isAuthenticated: true,
  })),
}));

// ─── Mock qrcode ──────────────────────────────────────────────────────────────

vi.mock("qrcode", () => ({
  default: {
    toString: vi.fn().mockResolvedValue('<svg data-testid="mock-qr-svg"><rect /></svg>'),
  },
}));

// ─── Import component under test ──────────────────────────────────────────────
// Import AFTER all mocks are set up.

import { LabelManagementPanel } from "../LabelManagementPanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  caseId: "j57abc000" as const,
  caseLabel: "CASE-001",
  hasExistingQrCode: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LabelManagementPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mutation returns a successful generate result
    mockMutationFn.mockResolvedValue({
      caseId:         "j57abc000",
      qrCode:         "https://scan.example.com/case/j57abc000?uid=abc123&source=generated",
      wasRegenerated: false,
    });
    // Default: validateQrCode returns undefined (loading / no input)
    mockQueryResult.mockReturnValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  // ── Panel structure ──────────────────────────────────────────────

  it("renders the panel with the generate mode tab active by default", () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("label-management-panel")).toBeTruthy();
    const generateTab = screen.getByTestId("mode-tab-generate");
    expect(generateTab.getAttribute("aria-selected")).toBe("true");
    const associateTab = screen.getByTestId("mode-tab-associate");
    expect(associateTab.getAttribute("aria-selected")).toBe("false");
  });

  it("renders the panel header with the case label", () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText(/Label — CASE-001/)).toBeTruthy();
  });

  it("renders generic header when caseLabel is omitted", () => {
    render(<LabelManagementPanel caseId="j57abc000" />);
    expect(screen.getByText("QR Label Management")).toBeTruthy();
  });

  // ── Mode switching ────────────────────────────────────────────────

  it("switches to associate mode when the Associate Existing tab is clicked", () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));
    const associateTab = screen.getByTestId("mode-tab-associate");
    expect(associateTab.getAttribute("aria-selected")).toBe("true");
    // Associate form should be visible
    expect(screen.getByTestId("associate-form")).toBeTruthy();
  });

  it("switches back to generate mode when the Generate New tab is clicked", () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    // Switch to associate first
    fireEvent.click(screen.getByTestId("mode-tab-associate"));
    // Switch back to generate
    fireEvent.click(screen.getByTestId("mode-tab-generate"));
    const generateTab = screen.getByTestId("mode-tab-generate");
    expect(generateTab.getAttribute("aria-selected")).toBe("true");
    // Generate idle UI should be visible
    expect(screen.getByTestId("generate-idle")).toBeTruthy();
  });

  // ── Generate flow: idle ───────────────────────────────────────────

  it("shows the Generate QR Code button in idle state", () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("generate-submit")).toBeTruthy();
    expect(screen.getByTestId("generate-submit").textContent).toContain(
      "Generate QR Code"
    );
  });

  it("shows Regenerate label and force-regenerate checkbox when hasExistingQrCode=true", () => {
    render(
      <LabelManagementPanel {...DEFAULT_PROPS} hasExistingQrCode={true} />
    );
    expect(screen.getByTestId("generate-submit").textContent).toContain(
      "Regenerate QR Code"
    );
    expect(screen.getByTestId("force-regenerate-checkbox")).toBeTruthy();
  });

  it("does NOT show force-regenerate checkbox when hasExistingQrCode=false", () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} hasExistingQrCode={false} />);
    expect(screen.queryByTestId("force-regenerate-checkbox")).toBeNull();
  });

  // ── Generate flow: loading → success ─────────────────────────────

  it("shows loading spinner while generate mutation is pending", async () => {
    // Make the mutation hang indefinitely (never resolve during this test)
    let resolveHang!: () => void;
    const hangPromise = new Promise<{
      caseId: string;
      qrCode: string;
      wasRegenerated: boolean;
    }>((resolve) => {
      resolveHang = () =>
        resolve({
          caseId:         "j57abc000",
          qrCode:         "https://scan.example.com/case/j57abc000",
          wasRegenerated: false,
        });
    });
    mockMutationFn.mockReturnValue(hangPromise);

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-submit"));
    });

    expect(screen.getByTestId("generate-loading")).toBeTruthy();

    // Resolve to prevent dangling async work
    resolveHang();
  });

  it("shows success state with QR display after successful generation", async () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("generate-success")).toBeTruthy();
    });

    // Success banner should indicate the QR was generated
    expect(
      screen.getByText(/QR code generated successfully/i)
    ).toBeTruthy();

    // QR SVG should be rendered
    expect(screen.getByRole("img", { name: /QR code for case/i })).toBeTruthy();
  });

  it("shows 'regenerated' message when wasRegenerated=true", async () => {
    mockMutationFn.mockResolvedValue({
      caseId:          "j57abc000",
      qrCode:          "https://scan.example.com/case/j57abc000?uid=newcode",
      wasRegenerated:  true,
      previousQrCode:  "https://scan.example.com/case/j57abc000?uid=oldcode",
    });

    render(
      <LabelManagementPanel {...DEFAULT_PROPS} hasExistingQrCode={true} />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-submit"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/QR code regenerated successfully/i)
      ).toBeTruthy();
    });
  });

  it("calls onGenerated callback with the mutation result", async () => {
    const onGenerated = vi.fn();
    const expectedResult = {
      caseId:         "j57abc000",
      qrCode:         "https://scan.example.com/case/j57abc000?uid=abc123&source=generated",
      wasRegenerated: false,
    };
    mockMutationFn.mockResolvedValue(expectedResult);

    render(
      <LabelManagementPanel {...DEFAULT_PROPS} onGenerated={onGenerated} />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-submit"));
    });

    await waitFor(() => {
      expect(onGenerated).toHaveBeenCalledWith(expectedResult);
    });
  });

  it("shows generate idle again after clicking 'Generate another'", async () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("generate-success")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("generate-reset"));
    expect(screen.getByTestId("generate-idle")).toBeTruthy();
  });

  // ── Generate flow: error ──────────────────────────────────────────

  it("shows error state when generation mutation throws", async () => {
    mockMutationFn.mockRejectedValue(
      new Error("generateQRCodeForCase: Case not found.")
    );

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("generate-error")).toBeTruthy();
    });

    expect(screen.getByText(/QR code generation failed/i)).toBeTruthy();
    expect(
      screen.getByText(/generateQRCodeForCase: Case not found/i)
    ).toBeTruthy();
  });

  it("retries generation from the error state", async () => {
    mockMutationFn
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        caseId:         "j57abc000",
        qrCode:         "https://scan.example.com/case/j57abc000",
        wasRegenerated: false,
      });

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("generate-error")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-retry"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("generate-success")).toBeTruthy();
    });
  });

  // ── Associate flow: form ──────────────────────────────────────────

  it("renders the associate form with input and submit button", () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));
    expect(screen.getByTestId("associate-form")).toBeTruthy();
    expect(screen.getByTestId("associate-input")).toBeTruthy();
    expect(screen.getByTestId("associate-submit")).toBeTruthy();
  });

  it("disables the submit button when input is empty", () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));
    const submitBtn = screen.getByTestId("associate-submit") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("enables the submit button when input has non-empty text", () => {
    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));

    const input = screen.getByTestId("associate-input");
    fireEvent.change(input, {
      target: { value: "https://scan.example.com/case/j57abc000?uid=test" },
    });

    const submitBtn = screen.getByTestId("associate-submit") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  // ── Associate flow: loading → success ─────────────────────────────

  it("shows loading spinner while associate mutation is pending", async () => {
    let resolveHang!: () => void;
    const hangPromise = new Promise<{
      caseId: string;
      qrCode: string;
      wasAlreadyMapped: boolean;
    }>((resolve) => {
      resolveHang = () =>
        resolve({
          caseId:           "j57abc000",
          qrCode:           "https://scan.example.com/case/j57abc000",
          wasAlreadyMapped: false,
        });
    });
    mockMutationFn.mockReturnValue(hangPromise);

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));

    const input = screen.getByTestId("associate-input");
    fireEvent.change(input, {
      target: { value: "https://scan.example.com/case/j57abc000" },
    });

    await act(async () => {
      fireEvent.submit(screen.getByTestId("associate-form"));
    });

    expect(screen.getByTestId("associate-loading")).toBeTruthy();
    resolveHang();
  });

  it("shows success state with QR display after successful association", async () => {
    mockMutationFn.mockResolvedValue({
      caseId:           "j57abc000",
      qrCode:           "https://scan.example.com/case/j57abc000?uid=xyz",
      wasAlreadyMapped: false,
    });

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));

    const input = screen.getByTestId("associate-input");
    fireEvent.change(input, {
      target: { value: "https://scan.example.com/case/j57abc000?uid=xyz" },
    });

    await act(async () => {
      fireEvent.submit(screen.getByTestId("associate-form"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("associate-success")).toBeTruthy();
    });

    expect(
      screen.getByText(/QR code successfully associated/i)
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: /QR code for case/i })).toBeTruthy();
  });

  it("shows 'already linked' message when wasAlreadyMapped=true", async () => {
    mockMutationFn.mockResolvedValue({
      caseId:           "j57abc000",
      qrCode:           "https://scan.example.com/case/j57abc000",
      wasAlreadyMapped: true,
    });

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));

    fireEvent.change(screen.getByTestId("associate-input"), {
      target: { value: "https://scan.example.com/case/j57abc000" },
    });

    await act(async () => {
      fireEvent.submit(screen.getByTestId("associate-form"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/already linked to this case/i)
      ).toBeTruthy();
    });
  });

  it("calls onAssociated callback with the mutation result", async () => {
    const onAssociated = vi.fn();
    const expectedResult = {
      caseId:           "j57abc000",
      qrCode:           "https://scan.example.com/case/j57abc000?uid=xyz",
      wasAlreadyMapped: false,
    };
    mockMutationFn.mockResolvedValue(expectedResult);

    render(
      <LabelManagementPanel
        {...DEFAULT_PROPS}
        onAssociated={onAssociated}
      />
    );
    fireEvent.click(screen.getByTestId("mode-tab-associate"));
    fireEvent.change(screen.getByTestId("associate-input"), {
      target: { value: "https://scan.example.com/case/j57abc000?uid=xyz" },
    });

    await act(async () => {
      fireEvent.submit(screen.getByTestId("associate-form"));
    });

    await waitFor(() => {
      expect(onAssociated).toHaveBeenCalledWith(expectedResult);
    });
  });

  it("shows associate form again after clicking 'Associate a different code'", async () => {
    mockMutationFn.mockResolvedValue({
      caseId:           "j57abc000",
      qrCode:           "https://scan.example.com/case/j57abc000",
      wasAlreadyMapped: false,
    });

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));
    fireEvent.change(screen.getByTestId("associate-input"), {
      target: { value: "https://scan.example.com/case/j57abc000" },
    });

    await act(async () => {
      fireEvent.submit(screen.getByTestId("associate-form"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("associate-success")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("associate-reset"));
    expect(screen.getByTestId("associate-form")).toBeTruthy();
  });

  // ── Associate flow: error ─────────────────────────────────────────

  it("shows error state when associate mutation throws", async () => {
    mockMutationFn.mockRejectedValue(
      new Error("associateQRCodeToCase: QR code already mapped to CASE-002.")
    );

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));
    fireEvent.change(screen.getByTestId("associate-input"), {
      target: { value: "https://scan.example.com/case/j57abc000" },
    });

    await act(async () => {
      fireEvent.submit(screen.getByTestId("associate-form"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("associate-error")).toBeTruthy();
    });

    expect(screen.getByText(/Association failed/i)).toBeTruthy();
    expect(
      screen.getByText(/QR code already mapped to CASE-002/i)
    ).toBeTruthy();
  });

  it("returns to form after clicking 'Try again' from error state", async () => {
    mockMutationFn.mockRejectedValue(new Error("Network error"));

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));
    fireEvent.change(screen.getByTestId("associate-input"), {
      target: { value: "https://scan.example.com/case/j57abc000" },
    });

    await act(async () => {
      fireEvent.submit(screen.getByTestId("associate-form"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("associate-error")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("associate-back"));
    expect(screen.getByTestId("associate-form")).toBeTruthy();
  });

  // ── Validation badge (real-time) ──────────────────────────────────

  it("shows Available badge when validateQrCode returns available", () => {
    mockQueryResult.mockReturnValue({ status: "available" });

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));

    fireEvent.change(screen.getByTestId("associate-input"), {
      target: { value: "https://scan.example.com/case/abc?uid=test" },
    });

    // Badge should appear with "Available" text
    expect(screen.getByText("Available")).toBeTruthy();
  });

  it("shows 'In use on' badge when validateQrCode returns mapped_to_other_case", () => {
    mockQueryResult.mockReturnValue({
      status: "mapped_to_other_case",
      conflictingCaseLabel: "CASE-999",
      conflictingCaseId: "j57abc999",
    });

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));

    fireEvent.change(screen.getByTestId("associate-input"), {
      target: { value: "https://scan.example.com/case/abc?uid=test" },
    });

    expect(screen.getByText(/In use on/i)).toBeTruthy();
  });

  it("disables submit when validateQrCode returns mapped_to_this_case", () => {
    mockQueryResult.mockReturnValue({ status: "mapped_to_this_case" });

    render(<LabelManagementPanel {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByTestId("mode-tab-associate"));

    fireEvent.change(screen.getByTestId("associate-input"), {
      target: { value: "https://scan.example.com/case/j57abc000" },
    });

    const submitBtn = screen.getByTestId("associate-submit") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(screen.getByText("Already linked")).toBeTruthy();
  });
});
