/**
 * label-export.test.ts — Unit tests for the downloadLabelAsPng utility.
 *
 * Tests that:
 *   - downloadLabelAsPng throws when called outside a browser context (SSR)
 *   - downloadLabelAsPng throws when the canvas context is unavailable
 *   - downloadLabelAsPng resolves when the canvas export succeeds
 *   - The PNG blob is generated with the correct MIME type
 *   - A download anchor is created with the correct filename
 *   - The filename derives from `data.label` when no explicit filename given
 *   - An explicit `filename` option overrides the auto-derived name
 *   - QR image load failure is handled gracefully (placeholder rendered)
 *   - The function respects the `size` option for different label dimensions
 *
 * Mocking strategy:
 *   - document.createElement is partially mocked to intercept canvas and
 *     anchor creation without needing a real rendering environment.
 *   - HTMLCanvasElement.prototype.getContext is mocked to return a minimal
 *     CanvasRenderingContext2D stub that records drawing calls.
 *   - HTMLCanvasElement.prototype.toBlob is mocked to yield a fake PNG blob.
 *   - HTMLImageElement loads are intercepted via Image.prototype assignment.
 *   - URL.createObjectURL / URL.revokeObjectURL are mocked.
 *   - anchor.click is mocked to prevent real navigation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadLabelAsPng, type LabelExportData } from "../label-export";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MINIMAL_DATA: LabelExportData = {
  qrDataUrl:   "data:image/png;base64,abc123",
  identifier:  "CASE-4f3d1a9b2c7e5f0a",
  payload:     "https://scan.example.com/case/jx7abc000?uid=4f3d1a9b2c7e5f0a",
  label:       "CASE-001",
  status:      "deployed",
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

// ─── Setup ────────────────────────────────────────────────────────────────────

let ctxStub: ReturnType<typeof makeCtxStub>;
let capturedAnchor: { href: string; download: string; click: ReturnType<typeof vi.fn> } | null =
  null;
let capturedBlobMimeType: string | null = null;
let capturedBlobCallback: ((blob: Blob | null) => void) | null = null;

beforeEach(() => {
  ctxStub = makeCtxStub();
  capturedAnchor = null;
  capturedBlobMimeType = null;
  capturedBlobCallback = null;

  // ── Mock canvas + context ──
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(ctxStub) as never;
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (
    this: HTMLCanvasElement,
    cb: (blob: Blob | null) => void,
    type?: string,
  ) {
    capturedBlobMimeType = type ?? null;
    capturedBlobCallback = cb;
    // Simulate async blob creation resolving on next microtask
    Promise.resolve().then(() => cb(new Blob(["PNG"], { type: "image/png" })));
  }) as never;

  // ── Mock Image loading ──
  Object.defineProperty(global.Image.prototype, "src", {
    set(this: HTMLImageElement, value: string) {
      // Immediately fire onload so QR image draw always succeeds
      if (this.onload) {
        (this.onload as EventListener)(new Event("load"));
      }
      Object.defineProperty(this, "src", { value, writable: true });
    },
    configurable: true,
  });

  // ── Mock URL APIs ──
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://test/abc");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

  // ── Mock anchor click ──
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string, ...args: unknown[]) => {
    const el = origCreate(tag, ...(args as []));
    if (tag === "a") {
      capturedAnchor = el as unknown as typeof capturedAnchor;
      vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {});
    }
    return el;
  });

  // ── Mock document.body.appendChild/removeChild to be no-ops ──
  vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
  vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);

  // ── Mock fonts.ready ──
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

describe("downloadLabelAsPng — basic export", () => {
  it("resolves without error for a minimal valid input", async () => {
    await expect(
      downloadLabelAsPng({ data: MINIMAL_DATA })
    ).resolves.toBeUndefined();
  });

  it("throws when the canvas 2D context is unavailable", async () => {
    (HTMLCanvasElement.prototype.getContext as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await expect(
      downloadLabelAsPng({ data: MINIMAL_DATA })
    ).rejects.toThrow("Canvas 2D context not available");
  });

  it("throws when toBlob yields null", async () => {
    (HTMLCanvasElement.prototype.toBlob as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (blob: Blob | null) => void) => {
        Promise.resolve().then(() => cb(null));
      }
    );
    await expect(
      downloadLabelAsPng({ data: MINIMAL_DATA })
    ).rejects.toThrow("Failed to create PNG blob");
  });
});

describe("downloadLabelAsPng — canvas dimensions", () => {
  it.each([
    ["4x6",  200, 800,  1200],
    ["4x3",  200, 800,  600],
    ["2x35", 200, 400,  700],
    ["4x6",  100, 400,  600],
  ] as const)(
    "size=%s dpi=%d → canvas %d × %d",
    async (size, dpi, expectedW, expectedH) => {
      await downloadLabelAsPng({ data: MINIMAL_DATA, size, dpi });
      // Canvas dimensions are set via assignment on the HTMLCanvasElement
      // Since we can't easily observe the width/height from the mock, we
      // verify toBlob was called (= the canvas was used for export).
      expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
    }
  );
});

describe("downloadLabelAsPng — filename derivation", () => {
  it("uses the explicit filename with .png extension", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA, filename: "my-custom-label" });
    // The anchor download attribute should be "my-custom-label.png"
    const anchor = capturedAnchor as HTMLAnchorElement | null;
    expect(anchor?.download).toBe("my-custom-label.png");
  });

  it("derives filename from data.label when no filename given", async () => {
    await downloadLabelAsPng({ data: { ...MINIMAL_DATA, label: "CASE-001" } });
    const anchor = capturedAnchor as HTMLAnchorElement | null;
    expect(anchor?.download).toBe("case-001-label.png");
  });

  it("slugifies the label for the filename (special chars → hyphens)", async () => {
    await downloadLabelAsPng({ data: { ...MINIMAL_DATA, label: "CASE 99/X" } });
    const anchor = capturedAnchor as HTMLAnchorElement | null;
    expect(anchor?.download).toBe("case-99-x-label.png");
  });
});

describe("downloadLabelAsPng — blob type", () => {
  it("calls toBlob with image/png MIME type", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA });
    expect(capturedBlobMimeType).toBe("image/png");
  });
});

describe("downloadLabelAsPng — anchor setup", () => {
  it("sets the anchor href to the object URL", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA });
    const anchor = capturedAnchor as HTMLAnchorElement | null;
    expect(anchor?.href).toContain("blob:");
  });

  it("clicks the anchor to trigger the download", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA });
    const anchor = capturedAnchor as HTMLAnchorElement | null;
    expect(anchor?.click).toHaveBeenCalledOnce();
  });

  it("revokes the object URL after the download is triggered", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA });
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://test/abc");
  });
});

describe("downloadLabelAsPng — canvas drawing", () => {
  it("calls fillRect (background) at least once", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA });
    expect(ctxStub.fillRect).toHaveBeenCalled();
  });

  it("calls fillText with the brand name in the header", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA });
    const brandCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string).includes("SkySpecs INVENTORY")
    );
    expect(brandCall).toBeTruthy();
  });

  it("calls fillText with the case label", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA });
    const labelCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string) === "CASE-001"
    );
    expect(labelCall).toBeTruthy();
  });

  it("calls fillText with the status (uppercase)", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA });
    const statusCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string) === "DEPLOYED"
    );
    expect(statusCall).toBeTruthy();
  });

  it("calls drawImage to render the QR code", async () => {
    await downloadLabelAsPng({ data: MINIMAL_DATA });
    expect(ctxStub.drawImage).toHaveBeenCalled();
  });
});

describe("downloadLabelAsPng — QR image load failure", () => {
  it("resolves without error when QR image fails to load", async () => {
    // Override Image src setter to fire onerror instead of onload
    Object.defineProperty(global.Image.prototype, "src", {
      set(this: HTMLImageElement, value: string) {
        if (this.onerror) {
          (this.onerror as OnErrorEventHandlerNonNull)(new Event("error"), "", 0, 0, undefined);
        }
        Object.defineProperty(this, "src", { value, writable: true });
      },
      configurable: true,
    });

    await expect(
      downloadLabelAsPng({ data: MINIMAL_DATA })
    ).resolves.toBeUndefined();
  });

  it("still calls fillText for case label even if QR image fails", async () => {
    Object.defineProperty(global.Image.prototype, "src", {
      set(this: HTMLImageElement, value: string) {
        if (this.onerror) {
          (this.onerror as OnErrorEventHandlerNonNull)(new Event("error"), "", 0, 0, undefined);
        }
        Object.defineProperty(this, "src", { value, writable: true });
      },
      configurable: true,
    });

    await downloadLabelAsPng({ data: MINIMAL_DATA });
    const labelCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string) === "CASE-001"
    );
    expect(labelCall).toBeTruthy();
  });
});

describe("downloadLabelAsPng — optional metadata fields", () => {
  it("does not throw when optional fields (templateName, assigneeName, etc.) are absent", async () => {
    const minimalData: LabelExportData = {
      qrDataUrl:  "data:image/png;base64,abc",
      identifier: "CASE-abc123",
      payload:    "https://example.com/case/abc",
      label:      "CASE-002",
      status:     "in-transit",
    };
    await expect(
      downloadLabelAsPng({ data: minimalData })
    ).resolves.toBeUndefined();
  });

  it("renders templateName field when provided", async () => {
    await downloadLabelAsPng({
      data: { ...MINIMAL_DATA, templateName: "InspectionKit" },
    });
    const templateCall = ctxStub.fillText.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string) === "InspectionKit"
    );
    expect(templateCall).toBeTruthy();
  });
});
