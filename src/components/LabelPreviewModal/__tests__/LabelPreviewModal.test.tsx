/**
 * LabelPreviewModal — unit tests.
 *
 * Tests that:
 *   - Modal renders when isOpen=true and is absent when isOpen=false
 *   - The dialog receives proper ARIA attributes
 *   - Size tabs are rendered with the correct initial selection
 *   - Clicking a size tab switches the active size
 *   - The close button triggers onClose
 *   - The cancel button triggers onClose
 *   - The print button triggers triggerPrint when QR is ready
 *   - The print button is disabled while QR is loading
 *   - The loading state is shown while QR is generating
 *   - The error state is shown (with retry button) when QR generation fails
 *   - Clicking the retry button calls regenerate
 *   - The label is rendered once QR is ready
 *
 * Mocking strategy:
 *   - usePrintLabel is mocked via vi.mock to control qrState without
 *     needing Web Crypto or the qrcode library.
 *   - dialog.showModal() and dialog.close() are polyfilled because jsdom
 *     does not implement the native <dialog> APIs; the polyfills set/remove
 *     the `open` attribute so subsequent state checks work correctly.
 *   - ReactDOM.createPortal is kept real; document.body is available in
 *     jsdom so portals render normally.
 *   - Queries use data-testid (not ARIA roles) to avoid jsdom's behavior of
 *     hiding content inside a <dialog> element that lacks the `open` attribute.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import * as React from "react";

// ── Mock usePrintLabel ────────────────────────────────────────────────────────
// We control qrState via this mutable object so each test can configure it.

const mockTriggerPrint  = vi.fn();
const mockRegenerate    = vi.fn();
const mockDownloadAsPng = vi.fn().mockResolvedValue(undefined);

let mockQrState: {
  status: "idle" | "loading" | "ready" | "error";
  svg?: string;
  dataUrl?: string;
  identifier?: string;
  payload?: string;
  error?: Error;
} = { status: "loading" };

vi.mock("@/hooks/use-print-label", () => ({
  usePrintLabel: vi.fn(() => ({
    qrState: mockQrState,
    triggerPrint: mockTriggerPrint,
    regenerate: mockRegenerate,
    downloadAsPng: mockDownloadAsPng,
  })),
}));

// ── Polyfill HTMLDialogElement ────────────────────────────────────────────────
// jsdom does not implement showModal() / close(). We polyfill them once so
// the component code can call them and the `open` attribute is set correctly.

beforeAll(() => {
  if (typeof HTMLDialogElement !== "undefined") {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
        this.removeAttribute("open");
        // Dispatch the native close event so event listeners fire
        this.dispatchEvent(new Event("close"));
      };
    }
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Reset QR state between tests
  mockQrState = { status: "loading" };
});

// ── Import after mocks are configured ────────────────────────────────────────

import { LabelPreviewModal, type LabelPreviewCaseData } from "../LabelPreviewModal";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_DATA: LabelPreviewCaseData = {
  label: "CASE-001",
  status: "deployed",
  templateName: "Inspection Kit",
  assigneeName: "Jane Doe",
};

const CASE_ID = "jx7abc000testcase";

const MINIMAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="white"/></svg>`;

const READY_STATE = {
  status: "ready" as const,
  svg: MINIMAL_SVG,
  dataUrl: "data:image/png;base64,abc123",
  identifier: "CASE-4f3d1a9b2c7e5f0a",
  payload: "https://scan.example.com/case/jx7abc000testcase?uid=4f3d1a9b2c7e5f0a",
};

// ── Render helper ─────────────────────────────────────────────────────────────

function renderModal(
  props: Partial<React.ComponentProps<typeof LabelPreviewModal>> = {}
) {
  const defaultProps: React.ComponentProps<typeof LabelPreviewModal> = {
    isOpen: true,
    onClose: vi.fn(),
    caseId: CASE_ID,
    caseData: CASE_DATA,
  };
  return render(<LabelPreviewModal {...defaultProps} {...props} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LabelPreviewModal — rendering", () => {
  it("renders the modal element when isOpen=true", () => {
    renderModal({ isOpen: true });
    expect(screen.getByTestId("label-preview-modal")).toBeTruthy();
  });

  it("does not render the modal element when isOpen=false", () => {
    renderModal({ isOpen: false });
    // Dialog is rendered but should not have the `open` attribute
    const dialog = screen.queryByTestId("label-preview-modal");
    if (dialog) {
      expect(dialog.hasAttribute("open")).toBe(false);
    }
  });

  it("shows the modal title 'Label Preview'", () => {
    renderModal();
    expect(screen.getByText("Label Preview")).toBeTruthy();
  });

  it("shows the case label as the subtitle", () => {
    renderModal();
    expect(screen.getByText("CASE-001")).toBeTruthy();
  });

  it("has aria-labelledby pointing to the title element ID", () => {
    renderModal();
    const dialog = screen.getByTestId("label-preview-modal");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      "label-preview-dialog-title"
    );
  });

  it("has aria-describedby pointing to the subtitle element ID", () => {
    renderModal();
    const dialog = screen.getByTestId("label-preview-modal");
    expect(dialog.getAttribute("aria-describedby")).toBe(
      "label-preview-dialog-desc"
    );
  });

  it("sets the `open` attribute when isOpen=true (showModal polyfill)", () => {
    renderModal({ isOpen: true });
    const dialog = screen.getByTestId("label-preview-modal");
    expect(dialog.hasAttribute("open")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("LabelPreviewModal — size tabs", () => {
  it("renders all three size tabs", () => {
    renderModal();
    expect(screen.getByTestId("size-tab-4x6")).toBeTruthy();
    expect(screen.getByTestId("size-tab-4x3")).toBeTruthy();
    expect(screen.getByTestId("size-tab-2x35")).toBeTruthy();
  });

  it("marks the default size (4×6) as checked via aria-checked", () => {
    renderModal();
    expect(
      screen.getByTestId("size-tab-4x6").getAttribute("aria-checked")
    ).toBe("true");
  });

  it("marks other tabs as aria-checked=false by default", () => {
    renderModal();
    expect(
      screen.getByTestId("size-tab-4x3").getAttribute("aria-checked")
    ).toBe("false");
    expect(
      screen.getByTestId("size-tab-2x35").getAttribute("aria-checked")
    ).toBe("false");
  });

  it("respects initialSize='4x3' prop", () => {
    renderModal({ initialSize: "4x3" });
    expect(
      screen.getByTestId("size-tab-4x3").getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByTestId("size-tab-4x6").getAttribute("aria-checked")
    ).toBe("false");
  });

  it("switches the active size when a tab is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("size-tab-4x3"));
    expect(
      screen.getByTestId("size-tab-4x3").getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByTestId("size-tab-4x6").getAttribute("aria-checked")
    ).toBe("false");
  });

  it("renders dimension strings for each size", () => {
    renderModal();
    expect(screen.getByText('4" × 6"')).toBeTruthy();
    expect(screen.getByText('4" × 3"')).toBeTruthy();
    expect(screen.getByText('2" × 3.5"')).toBeTruthy();
  });

  it("renders name labels (Standard, Compact, Mini)", () => {
    renderModal();
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("Compact")).toBeTruthy();
    expect(screen.getByText("Mini")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("LabelPreviewModal — close interactions", () => {
  it("calls onClose when the close (×) button is clicked", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByTestId("label-preview-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the footer Cancel button is clicked", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByTestId("label-preview-cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders the close button with an accessible label", () => {
    renderModal();
    const closeBtn = screen.getByTestId("label-preview-close");
    expect(closeBtn.getAttribute("aria-label")).toBe("Close label preview");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("LabelPreviewModal — QR loading state", () => {
  it("shows the loading indicator testid when QR is generating", () => {
    mockQrState = { status: "loading" };
    renderModal();
    expect(screen.getByTestId("label-preview-loading")).toBeTruthy();
  });

  it("shows the loading indicator when QR status is idle", () => {
    mockQrState = { status: "idle" };
    renderModal();
    expect(screen.getByTestId("label-preview-loading")).toBeTruthy();
  });

  it("shows the 'Generating QR code…' text while loading", () => {
    mockQrState = { status: "loading" };
    renderModal();
    expect(
      screen.getByTestId("label-preview-loading").textContent
    ).toContain("Generating QR code");
  });

  it("disables the print button while loading", () => {
    mockQrState = { status: "loading" };
    renderModal();
    const printBtn = screen.getByTestId("label-preview-print");
    expect(printBtn.hasAttribute("disabled")).toBe(true);
    expect(printBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("disables the download PNG button while loading", () => {
    mockQrState = { status: "loading" };
    renderModal();
    const downloadBtn = screen.getByTestId("label-preview-download-png");
    expect(downloadBtn.hasAttribute("disabled")).toBe(true);
    expect(downloadBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("does not show the error state while loading", () => {
    mockQrState = { status: "loading" };
    renderModal();
    expect(screen.queryByTestId("label-preview-error")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("LabelPreviewModal — QR error state", () => {
  beforeEach(() => {
    mockQrState = {
      status: "error",
      error: new Error("Crypto unavailable in insecure context"),
    };
  });

  it("shows the error state container", () => {
    renderModal();
    expect(screen.getByTestId("label-preview-error")).toBeTruthy();
  });

  it("shows the error title text", () => {
    renderModal();
    expect(screen.getByText("QR code generation failed")).toBeTruthy();
  });

  it("shows the error message", () => {
    renderModal();
    expect(
      screen.getByText("Crypto unavailable in insecure context")
    ).toBeTruthy();
  });

  it("renders a Retry button in the error state", () => {
    renderModal();
    expect(screen.getByTestId("label-preview-retry")).toBeTruthy();
  });

  it("calls regenerate when the Retry button is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("label-preview-retry"));
    expect(mockRegenerate).toHaveBeenCalledOnce();
  });

  it("disables the print button in the error state", () => {
    renderModal();
    const printBtn = screen.getByTestId("label-preview-print");
    expect(printBtn.hasAttribute("disabled")).toBe(true);
    expect(printBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("disables the download PNG button in the error state", () => {
    renderModal();
    const downloadBtn = screen.getByTestId("label-preview-download-png");
    expect(downloadBtn.hasAttribute("disabled")).toBe(true);
    expect(downloadBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("does not show the loading state in the error state", () => {
    renderModal();
    expect(screen.queryByTestId("label-preview-loading")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("LabelPreviewModal — QR ready state", () => {
  beforeEach(() => {
    mockQrState = READY_STATE;
  });

  it("renders the label preview area with a CaseLabel", () => {
    renderModal();
    // CaseLabel sets data-case-label-root on its root element
    const labelRoot = document.querySelector("[data-case-label-root]");
    expect(labelRoot).not.toBeNull();
  });

  it("does not show the loading state when QR is ready", () => {
    renderModal();
    expect(screen.queryByTestId("label-preview-loading")).toBeNull();
  });

  it("does not show the error state when QR is ready", () => {
    renderModal();
    expect(screen.queryByTestId("label-preview-error")).toBeNull();
  });

  it("enables the print button when QR is ready", () => {
    renderModal();
    const printBtn = screen.getByTestId("label-preview-print");
    expect(printBtn.hasAttribute("disabled")).toBe(false);
    expect(printBtn.getAttribute("aria-disabled")).toBe("false");
  });

  it("the print button is labelled 'Print'", () => {
    renderModal();
    const printBtn = screen.getByTestId("label-preview-print");
    expect(printBtn.textContent).toContain("Print");
  });

  it("calls triggerPrint when the Print button is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("label-preview-print"));
    expect(mockTriggerPrint).toHaveBeenCalledOnce();
  });

  it("calls onBeforePrint before triggerPrint when both are provided", () => {
    const calls: string[] = [];
    const onBeforePrint = vi.fn(() => calls.push("before"));
    mockTriggerPrint.mockImplementationOnce(() => calls.push("print"));

    renderModal({ onBeforePrint });
    fireEvent.click(screen.getByTestId("label-preview-print"));

    expect(calls).toEqual(["before", "print"]);
    expect(onBeforePrint).toHaveBeenCalledOnce();
  });

  it("renders the Download PNG button when QR is ready", () => {
    renderModal();
    expect(screen.getByTestId("label-preview-download-png")).toBeTruthy();
  });

  it("enables the Download PNG button when QR is ready", () => {
    renderModal();
    const downloadBtn = screen.getByTestId("label-preview-download-png");
    expect(downloadBtn.hasAttribute("disabled")).toBe(false);
    expect(downloadBtn.getAttribute("aria-disabled")).toBe("false");
  });

  it("the Download PNG button shows 'Download PNG' text", () => {
    renderModal();
    const downloadBtn = screen.getByTestId("label-preview-download-png");
    expect(downloadBtn.textContent).toContain("Download PNG");
  });

  it("calls downloadAsPng when the Download PNG button is clicked", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("label-preview-download-png"));
    // Give the async handler a tick to invoke downloadAsPng
    await act(async () => {});
    expect(mockDownloadAsPng).toHaveBeenCalledOnce();
  });

  it("passes caseData fields to downloadAsPng", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("label-preview-download-png"));
    await act(async () => {});
    expect(mockDownloadAsPng).toHaveBeenCalledWith(
      expect.objectContaining({
        label:        CASE_DATA.label,
        status:       CASE_DATA.status,
        templateName: CASE_DATA.templateName,
        assigneeName: CASE_DATA.assigneeName,
      }),
      expect.any(String), // size
      expect.any(String), // filename
    );
  });

  it("calls onBeforeDownload before downloadAsPng when provided", async () => {
    const calls: string[] = [];
    const onBeforeDownload = vi.fn(() => calls.push("before"));
    mockDownloadAsPng.mockImplementationOnce(async () => calls.push("download"));

    renderModal({ onBeforeDownload });
    fireEvent.click(screen.getByTestId("label-preview-download-png"));
    await act(async () => {});

    expect(calls[0]).toBe("before");
    expect(onBeforeDownload).toHaveBeenCalledOnce();
  });

  it("renders the CaseLabel with the default 4×6 size", () => {
    renderModal();
    const labelRoot = document.querySelector("[data-case-label-root]");
    expect(labelRoot!.getAttribute("data-label-size")).toBe("4x6");
  });

  it("renders the CaseLabel with the selected size after tab click", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("size-tab-4x3"));
    const labelRoot = document.querySelector("[data-case-label-root]");
    expect(labelRoot!.getAttribute("data-label-size")).toBe("4x3");
  });

  it("renders the case label text inside the label preview (appears in subtitle + CaseLabel)", () => {
    renderModal();
    // "CASE-001" appears in both the modal subtitle and the CaseLabel body.
    // getAllByText confirms it is present in multiple places as expected.
    const matches = screen.getAllByText("CASE-001");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the QR SVG inside the label", () => {
    renderModal();
    // At least one SVG should be present (QR code in CaseLabel)
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("LabelPreviewModal — dialog open/close lifecycle", () => {
  it("sets the `open` attribute on the dialog when isOpen=true", () => {
    // The showModal polyfill sets `open`; verify it's present after render
    renderModal({ isOpen: true });
    const dialog = screen.getByTestId("label-preview-modal");
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("does not set `open` on the dialog when isOpen=false", () => {
    renderModal({ isOpen: false });
    const dialog = screen.queryByTestId("label-preview-modal");
    if (dialog) {
      expect(dialog.hasAttribute("open")).toBe(false);
    }
  });

  it("removes the `open` attribute when isOpen changes from true to false", () => {
    const { rerender } = render(
      <LabelPreviewModal
        isOpen={true}
        onClose={vi.fn()}
        caseId={CASE_ID}
        caseData={CASE_DATA}
      />
    );

    const dialog = screen.getByTestId("label-preview-modal");
    expect(dialog.hasAttribute("open")).toBe(true);

    act(() => {
      rerender(
        <LabelPreviewModal
          isOpen={false}
          onClose={vi.fn()}
          caseId={CASE_ID}
          caseData={CASE_DATA}
        />
      );
    });

    expect(dialog.hasAttribute("open")).toBe(false);
  });
});
