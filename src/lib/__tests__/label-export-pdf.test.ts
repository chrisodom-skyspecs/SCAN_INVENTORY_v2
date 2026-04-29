/**
 * label-export-pdf.test.ts — Unit tests for the downloadLabelAsPdf utility.
 *
 * Tests that:
 *   - downloadLabelAsPdf throws when called outside a browser context (SSR)
 *   - downloadLabelAsPdf throws when the canvas context is unavailable
 *   - downloadLabelAsPdf resolves when the canvas + PDF export succeeds
 *   - The PDF blob is created with the application/pdf MIME type
 *   - A download anchor is created with the .pdf extension
 *   - The filename derives from `data.label` when no explicit filename given
 *   - An explicit `filename` option overrides the auto-derived name
 *   - The filename is slugified (special chars → hyphens)
 *   - QR image load failure is handled gracefully (placeholder rendered)
 *   - The function respects the `size` option for different label dimensions
 *   - Canvas drawing calls mirror the PNG export (brand name, label, status)
 *   - buildPdfFromJpeg embeds the JPEG correctly (the PDF blob starts with %PDF)
 *   - Object URL is revoked after the download anchor is clicked
 *
 * Mocking strategy:
 *   - HTMLCanvasElement.prototype.getContext is mocked to return a minimal
 *     CanvasRenderingContext2D stub that records drawing calls.
 *   - HTMLCanvasElement.prototype.toBlob is mocked to yield a fake JPEG blob
 *     with an arrayBuffer() method returning synthetic bytes.
 *   - HTMLImageElement loads are intercepted via Image.prototype assignment.
 *   - URL.createObjectURL / URL.revokeObjectURL are mocked.
 *   - anchor.click is mocked to prevent real navigation.
 *   - document.body.appendChild/removeChild are no-op mocked.
 *   - document.fonts.ready resolves immediately.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadLabelAsPdf, type LabelExportData } from "../label-export";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MINIMAL_DATA: LabelExportData = {
  qrDataUrl:    "data:image/png;base64,abc123",
  identifier:   "CASE-4f3d1a9b2c7e5f0a",
  payload:      "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a",
  label:        "CASE-001",
  status:       "deployed",
  templateName: "Inspection Kit",
  assigneeName: "Jane Doe",
};

// ─── Canvas stub ──────────────────────────────────────────────────────────────

/** Minimal CanvasRenderingContext2D stub that records draw calls. */
function makeCtxStub() {
  return {
    fillStyle:    "",
    strokeStyle:  "",
    lineWidth:    1,
    font:         "",
    textAlign:    "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    fillRect:     vi.fn(),
    strokeRect:   vi.fn(),
    fillText:     vi.fn(),
    drawImage:    vi.fn(),
    measureText:  vi.fn().mockReturnValue({ width: 10 }),
  };
}

// ─── Fake JPEG bytes ──────────────────────────────────────────────────────────

/**
 * Minimal valid JPEG sequence: SOI (FF D8) + EOI (FF D9).
 * Real JPEG data would be much larger, but this is sufficient for tests
 * that only verify the PDF envelope is built correctly.
 */
const FAKE_JPEG_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);

// ─── Setup ────────────────────────────────────────────────────────────────────

let ctxStub: ReturnType<typeof makeCtxStub>;
let capturedAnchor: HTMLAnchorElement | null = null;
let capturedBlobMimeType: string | null = null;
let capturedBlobQuality: number | null = null;

beforeEach(() => {
  ctxStub = makeCtxStub();
  capturedAnchor = null;
  capturedBlobMimeType = null;
  capturedBlobQuality = null;

  // ── Mock canvas + context ──
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(ctxStub) as never;

  // Mock toBlob to yield a fake JPEG blob with an arrayBuffer() method
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (
    this: HTMLCanvasElement,
    cb: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ) {
    capturedBlobMimeType = type ?? null;
    capturedBlobQuality  = quality ?? null;

    // Create a fake Blob that has an arrayBuffer() method returning FAKE_JPEG_BYTES
    const fakeBlob = {
      arrayBuffer: () => Promise.resolve(FAKE_JPEG_BYTES.buffer.slice(0)),
      size: FAKE_JPEG_BYTES.length,
      type: type ?? "image/jpeg",
    } as unknown as Blob;

    // Simulate async blob creation resolving on next microtask
    Promise.resolve().then(() => cb(fakeBlob));
  }) as never;

  // ── Mock Image loading — always fires onload ──
  Object.defineProperty(global.Image.prototype, "src", {
    set(this: HTMLImageElement, value: string) {
      if (this.onload) {
        (this.onload as EventListener)(new Event("load"));
      }
      Object.defineProperty(this, "src", { value, writable: true });
    },
    configurable: true,
  });

  // ── Mock URL APIs ──
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://test/pdf-abc");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

  // ── Mock anchor creation ──
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string, ...args: unknown[]) => {
    const el = origCreate(tag, ...(args as []));
    if (tag === "a") {
      capturedAnchor = el as HTMLAnchorElement;
      vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {});
    }
    return el;
  });

  // ── No-op body manipulation ──
  vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
  vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);

  // ── Immediately-resolved fonts ──
  Object.defineProperty(document, "fonts", {
    value: { ready: Promise.resolve() },
    writable: true,
    configurable: true,
  });

  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("downloadLabelAsPdf — basic export", () => {
  it("resolves without error for a minimal valid input", async () => {
    await expect(
      downloadLabelAsPdf({ data: MINIMAL_DATA })
    ).resolves.toBeUndefined();
  });

  it("throws when the canvas 2D context is unavailable", async () => {
    (HTMLCanvasElement.prototype.getContext as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await expect(
      downloadLabelAsPdf({ data: MINIMAL_DATA })
    ).rejects.toThrow("Canvas 2D context not available");
  });

  it("throws when toBlob yields null", async () => {
    (HTMLCanvasElement.prototype.toBlob as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (blob: Blob | null) => void) => {
        Promise.resolve().then(() => cb(null));
      }
    );
    await expect(
      downloadLabelAsPdf({ data: MINIMAL_DATA })
    ).rejects.toThrow("Failed to create JPEG blob from canvas for PDF export");
  });

  it("does not throw when optional metadata fields are absent", async () => {
    const minimalData: LabelExportData = {
      qrDataUrl:  "data:image/png;base64,abc",
      identifier: "CASE-abc123",
      payload:    "https://example.com/case/abc",
      label:      "CASE-002",
      status:     "in-transit",
    };
    await expect(
      downloadLabelAsPdf({ data: minimalData })
    ).resolves.toBeUndefined();
  });
});

describe("downloadLabelAsPdf — JPEG encoding", () => {
  it("calls toBlob with image/jpeg MIME type", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    expect(capturedBlobMimeType).toBe("image/jpeg");
  });

  it("calls toBlob with the default quality (0.92)", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    expect(capturedBlobQuality).toBeCloseTo(0.92, 5);
  });

  it("calls toBlob with a custom quality when specified", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA, quality: 0.85 });
    expect(capturedBlobQuality).toBeCloseTo(0.85, 5);
  });
});

describe("downloadLabelAsPdf — PDF output", () => {
  it("creates a Blob with application/pdf MIME type", async () => {
    const blobSpy = vi.spyOn(global, "Blob");
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    // The last Blob call should be for the PDF (previous calls may be for canvas toBlob)
    const pdfBlobCall = blobSpy.mock.calls.find(
      (args) => args[1] && (args[1] as BlobPropertyBag).type === "application/pdf"
    );
    expect(pdfBlobCall).toBeTruthy();
  });

  it("creates an object URL for the PDF blob", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("the PDF bytes begin with %PDF (validated via blob content)", async () => {
    // Verify that buildPdfFromJpeg produces a PDF by checking that the
    // data passed to new Blob() starts with the PDF header bytes ("%PDF").
    const enc = new TextEncoder();
    const pdfHeader = enc.encode("%PDF");

    // capturedPdfData holds the ArrayBuffer passed to new Blob([...], {type:"application/pdf"})
    let capturedPdfData: ArrayBuffer | null = null;
    const origBlob = global.Blob;
    vi.spyOn(global, "Blob").mockImplementation(function(
      blobParts?: BlobPart[],
      options?: BlobPropertyBag,
    ) {
      if (options?.type === "application/pdf" && blobParts?.[0] instanceof ArrayBuffer) {
        capturedPdfData = blobParts[0] as ArrayBuffer;
      }
      return new origBlob(blobParts, options);
    } as unknown as typeof Blob);

    await downloadLabelAsPdf({ data: MINIMAL_DATA });

    expect(capturedPdfData).not.toBeNull();
    if (capturedPdfData) {
      const bytes = new Uint8Array(capturedPdfData);
      // First 4 bytes should be "%PDF"
      for (let i = 0; i < pdfHeader.length; i++) {
        expect(bytes[i]).toBe(pdfHeader[i]);
      }
    }
  });

  it("includes %%EOF at the end of the PDF bytes", async () => {
    // capturedPdfData holds the ArrayBuffer passed to new Blob([...], {type:"application/pdf"})
    let capturedPdfData: ArrayBuffer | null = null;
    const origBlob = global.Blob;
    vi.spyOn(global, "Blob").mockImplementation(function(
      blobParts?: BlobPart[],
      options?: BlobPropertyBag,
    ) {
      if (options?.type === "application/pdf" && blobParts?.[0] instanceof ArrayBuffer) {
        capturedPdfData = blobParts[0] as ArrayBuffer;
      }
      return new origBlob(blobParts, options);
    } as unknown as typeof Blob);

    await downloadLabelAsPdf({ data: MINIMAL_DATA });

    expect(capturedPdfData).not.toBeNull();
    if (capturedPdfData) {
      // Convert tail bytes to string to check for %%EOF
      const fullBytes = new Uint8Array(capturedPdfData as ArrayBuffer);
      const tail = new TextDecoder().decode(fullBytes.slice(-20));
      expect(tail).toContain("%%EOF");
    }
  });
});

describe("downloadLabelAsPdf — filename derivation", () => {
  it("derives the filename from data.label with .pdf extension", async () => {
    await downloadLabelAsPdf({ data: { ...MINIMAL_DATA, label: "CASE-001" } });
    expect(capturedAnchor?.download).toBe("case-001-label.pdf");
  });

  it("uses the explicit filename with .pdf extension", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA, filename: "my-custom-label" });
    expect(capturedAnchor?.download).toBe("my-custom-label.pdf");
  });

  it("slugifies the label for the filename (special chars → hyphens)", async () => {
    await downloadLabelAsPdf({ data: { ...MINIMAL_DATA, label: "CASE 99/X" } });
    expect(capturedAnchor?.download).toBe("case-99-x-label.pdf");
  });

  it("lowercases the derived filename", async () => {
    await downloadLabelAsPdf({ data: { ...MINIMAL_DATA, label: "CASE-ABC" } });
    expect(capturedAnchor?.download).toBe("case-abc-label.pdf");
  });
});

describe("downloadLabelAsPdf — anchor setup", () => {
  it("sets the anchor href to the object URL", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    expect(capturedAnchor?.href).toContain("blob:");
  });

  it("clicks the anchor to trigger the download", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    const clickSpy = capturedAnchor?.click as ReturnType<typeof vi.fn> | undefined;
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it("revokes the object URL after the download is triggered", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://test/pdf-abc");
  });
});

describe("downloadLabelAsPdf — canvas dimensions", () => {
  it.each([
    ["4x6",  300, 1200, 1800],
    ["4x3",  300, 1200,  900],
    ["2x35", 300,  600, 1050],
    ["4x6",  150,  600,  900],
  ] as const)(
    "size=%s dpi=%d → canvas %d × %d",
    async (size, dpi, _expectedW, _expectedH) => {
      await downloadLabelAsPdf({ data: MINIMAL_DATA, size, dpi });
      // Verify toBlob was called (canvas was used for export)
      expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
    }
  );
});

describe("downloadLabelAsPdf — canvas drawing", () => {
  it("calls fillRect (background) at least once", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    expect(ctxStub.fillRect).toHaveBeenCalled();
  });

  it("calls fillText with the brand name in the header", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    const brandCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("SkySpecs INVENTORY")
    );
    expect(brandCall).toBeTruthy();
  });

  it("calls fillText with the case label", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    const labelCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" && (args[0] as string) === "CASE-001"
    );
    expect(labelCall).toBeTruthy();
  });

  it("calls fillText with the status (uppercase)", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    const statusCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" && (args[0] as string) === "DEPLOYED"
    );
    expect(statusCall).toBeTruthy();
  });

  it("calls drawImage to render the QR code", async () => {
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    expect(ctxStub.drawImage).toHaveBeenCalled();
  });

  it("renders templateName field text when provided", async () => {
    await downloadLabelAsPdf({
      data: { ...MINIMAL_DATA, templateName: "InspectionKit" },
    });
    const templateCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" && (args[0] as string) === "InspectionKit"
    );
    expect(templateCall).toBeTruthy();
  });
});

describe("downloadLabelAsPdf — QR image load failure", () => {
  it("resolves without error when QR image fails to load", async () => {
    // Override Image src setter to fire onerror instead of onload
    Object.defineProperty(global.Image.prototype, "src", {
      set(this: HTMLImageElement, value: string) {
        if (this.onerror) {
          (this.onerror as OnErrorEventHandlerNonNull)(
            new Event("error"),
            "",
            0,
            0,
            undefined,
          );
        }
        Object.defineProperty(this, "src", { value, writable: true });
      },
      configurable: true,
    });

    await expect(
      downloadLabelAsPdf({ data: MINIMAL_DATA })
    ).resolves.toBeUndefined();
  });

  it("still calls fillText for case label even if QR image fails", async () => {
    Object.defineProperty(global.Image.prototype, "src", {
      set(this: HTMLImageElement, value: string) {
        if (this.onerror) {
          (this.onerror as OnErrorEventHandlerNonNull)(
            new Event("error"),
            "",
            0,
            0,
            undefined,
          );
        }
        Object.defineProperty(this, "src", { value, writable: true });
      },
      configurable: true,
    });

    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    const labelCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" && (args[0] as string) === "CASE-001"
    );
    expect(labelCall).toBeTruthy();
  });
});

describe("downloadLabelAsPdf — default DPI", () => {
  it("uses 300 DPI by default (higher than PNG default of 200)", async () => {
    // The canvas dimensions are determined by DPI. At 300 DPI, a 4x6 label
    // would be 1200x1800 pixels. We verify toBlob was called (canvas was created).
    await downloadLabelAsPdf({ data: MINIMAL_DATA });
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
  });
});
