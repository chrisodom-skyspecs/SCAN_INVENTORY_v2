/**
 * CaseLabel component unit tests.
 *
 * Tests that:
 *   - Required data fields render correctly
 *   - Optional metadata fields are shown/hidden appropriately
 *   - The QR code SVG is injected safely
 *   - The fallback PNG <img> is rendered when qrSvg is absent
 *   - The print button is rendered when showPrintButton=true
 *   - The label renders with the correct data-label-size attribute
 *   - The component has appropriate ARIA landmarks
 *   - The printedAt override is rendered in the header
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CaseLabel, type CaseLabelData, type LabelSize } from "../CaseLabel";

afterEach(() => cleanup());

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MINIMAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="white"/></svg>`;

const BASE_DATA: CaseLabelData = {
  qrSvg: MINIMAL_SVG,
  identifier: "CASE-4f3d1a9b2c7e5f0a",
  payload: "https://scan.example.com/case/abc123?uid=4f3d1a9b2c7e5f0a",
  label: "CASE-001",
  status: "deployed",
};

const FULL_DATA: CaseLabelData = {
  ...BASE_DATA,
  templateName: "Inspection Kit",
  missionName: "Site A Deployment",
  assigneeName: "Jane Doe",
  locationName: "Grand Rapids, MI",
  createdAt: new Date("2026-01-15T10:30:00Z"),
  notes: "Handle with care",
};

// ─── Basic rendering ──────────────────────────────────────────────────────────

describe("CaseLabel — basic rendering", () => {
  it("renders the case display label", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.getByText("CASE-001")).toBeTruthy();
  });

  it("renders the case identifier", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.getByText("CASE-4f3d1a9b2c7e5f0a")).toBeTruthy();
  });

  it("renders the QR payload URL in the footer", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(
      screen.getByText(
        "https://scan.example.com/case/abc123?uid=4f3d1a9b2c7e5f0a"
      )
    ).toBeTruthy();
  });

  it("renders the brand name in the header", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.getByText("SkySpecs INVENTORY")).toBeTruthy();
  });

  it("renders the scan hint in the footer", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(
      screen.getByText("Scan QR code with camera to open in SCAN app")
    ).toBeTruthy();
  });

  it("renders the StatusPill for the case status", () => {
    render(<CaseLabel data={BASE_DATA} />);
    // StatusPill renders with role="status"
    const pills = screen.getAllByRole("status");
    expect(pills.length).toBeGreaterThan(0);
  });
});

// ─── QR code rendering ────────────────────────────────────────────────────────

describe("CaseLabel — QR code", () => {
  it("injects the SVG via dangerouslySetInnerHTML when qrSvg is provided", () => {
    render(<CaseLabel data={BASE_DATA} />);
    // The SVG element should be present in the DOM
    const svgEl = document.querySelector("svg");
    expect(svgEl).not.toBeNull();
  });

  it("renders an <img> fallback when qrSvg is empty and qrDataUrl is provided", () => {
    const data: CaseLabelData = {
      ...BASE_DATA,
      qrSvg: "",
      qrDataUrl: "data:image/png;base64,abc123",
    };
    render(<CaseLabel data={data} />);
    const img = screen.getByAltText(`QR code for case ${BASE_DATA.label}`);
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("data:image/png;base64,abc123");
  });

  it("renders the placeholder when neither qrSvg nor qrDataUrl is provided", () => {
    const data: CaseLabelData = {
      ...BASE_DATA,
      qrSvg: "",
      qrDataUrl: undefined,
    };
    render(<CaseLabel data={data} />);
    expect(screen.getByLabelText("QR code not available")).toBeTruthy();
  });
});

// ─── Optional metadata fields ─────────────────────────────────────────────────

describe("CaseLabel — optional metadata fields", () => {
  it("renders templateName when provided", () => {
    render(<CaseLabel data={FULL_DATA} />);
    expect(screen.getByText("Inspection Kit")).toBeTruthy();
  });

  it("hides templateName when not provided", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.queryByText("Template")).toBeNull();
  });

  it("renders missionName when provided", () => {
    render(<CaseLabel data={FULL_DATA} />);
    expect(screen.getByText("Site A Deployment")).toBeTruthy();
  });

  it("hides missionName when not provided", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.queryByText("Mission")).toBeNull();
  });

  it("renders assigneeName when provided", () => {
    render(<CaseLabel data={FULL_DATA} />);
    expect(screen.getByText("Jane Doe")).toBeTruthy();
  });

  it("hides assigneeName when not provided", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.queryByText("Assigned")).toBeNull();
  });

  it("renders locationName when provided", () => {
    render(<CaseLabel data={FULL_DATA} />);
    expect(screen.getByText("Grand Rapids, MI")).toBeTruthy();
  });

  it("renders notes when provided", () => {
    render(<CaseLabel data={FULL_DATA} />);
    expect(screen.getByText("Handle with care")).toBeTruthy();
  });

  it("hides notes section when not provided", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("renders createdAt as YYYY-MM-DD when provided as a Date", () => {
    render(<CaseLabel data={FULL_DATA} />);
    expect(screen.getByText("2026-01-15")).toBeTruthy();
  });

  it("renders createdAt when provided as an ISO string", () => {
    const data: CaseLabelData = {
      ...BASE_DATA,
      createdAt: "2025-06-20T08:00:00Z",
    };
    render(<CaseLabel data={data} />);
    expect(screen.getByText("2025-06-20")).toBeTruthy();
  });

  it("hides createdAt field when not provided", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.queryByText("Created")).toBeNull();
  });

  it("hides createdAt field when value is an invalid date string", () => {
    const data: CaseLabelData = {
      ...BASE_DATA,
      createdAt: "not-a-date",
    };
    render(<CaseLabel data={data} />);
    expect(screen.queryByText("Created")).toBeNull();
  });
});

// ─── Print button ─────────────────────────────────────────────────────────────

describe("CaseLabel — print button", () => {
  it("renders the print button by default", () => {
    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("hides the print button when showPrintButton=false", () => {
    render(<CaseLabel data={BASE_DATA} showPrintButton={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a custom printButtonLabel", () => {
    render(<CaseLabel data={BASE_DATA} printButtonLabel="Generate Label" />);
    // The button has aria-label that describes the action; match on text content
    expect(screen.getByText("Generate Label")).toBeTruthy();
  });

  it("calls window.print() when the print button is clicked", () => {
    const printMock = vi.fn();
    vi.stubGlobal("print", printMock);

    render(<CaseLabel data={BASE_DATA} />);
    fireEvent.click(screen.getByRole("button"));
    expect(printMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("calls onBeforePrint callback before window.print()", () => {
    const calls: string[] = [];
    const onBeforePrint = vi.fn(() => calls.push("before"));
    vi.stubGlobal("print", vi.fn(() => calls.push("print")));

    render(<CaseLabel data={BASE_DATA} onBeforePrint={onBeforePrint} />);
    fireEvent.click(screen.getByRole("button"));

    expect(calls).toEqual(["before", "print"]);
    expect(onBeforePrint).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});

// ─── Label size ───────────────────────────────────────────────────────────────

describe("CaseLabel — label sizes", () => {
  const sizes: LabelSize[] = ["4x6", "4x3", "2x35"];

  it.each(sizes)('sets data-label-size="%s" on the wrapper', (size) => {
    render(<CaseLabel data={BASE_DATA} size={size} />);
    const root = document.querySelector("[data-case-label-root]");
    expect(root).not.toBeNull();
    expect(root!.getAttribute("data-label-size")).toBe(size);
  });

  it('defaults to "4x6" when size is not provided', () => {
    render(<CaseLabel data={BASE_DATA} />);
    const root = document.querySelector("[data-case-label-root]");
    expect(root!.getAttribute("data-label-size")).toBe("4x6");
  });
});

// ─── Printed-at date ──────────────────────────────────────────────────────────

describe("CaseLabel — printedAt date", () => {
  it("renders the printedAt date in the header when provided", () => {
    const date = new Date("2026-04-28T12:00:00Z");
    render(<CaseLabel data={BASE_DATA} printedAt={date} />);
    expect(screen.getByText("2026-04-28")).toBeTruthy();
  });

  it("renders today's date when printedAt is not provided", () => {
    const today = new Date();
    const expected = [
      String(today.getFullYear()),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");

    render(<CaseLabel data={BASE_DATA} />);
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("the <time> element has a dateTime attribute matching the date", () => {
    const date = new Date("2026-04-28T12:00:00Z");
    render(<CaseLabel data={BASE_DATA} printedAt={date} />);
    const timeEl = document.querySelector("time");
    expect(timeEl).not.toBeNull();
    expect(timeEl!.getAttribute("dateTime")).toBe("2026-04-28");
  });
});

// ─── ARIA landmarks ───────────────────────────────────────────────────────────

describe("CaseLabel — ARIA landmarks", () => {
  it('renders the label as role="region" with an aria-label', () => {
    render(<CaseLabel data={BASE_DATA} />);
    const region = screen.getByRole("region", { name: /Case label: CASE-001/i });
    expect(region).toBeTruthy();
  });

  it("has a [data-case-label-root] attribute for print isolation", () => {
    render(<CaseLabel data={BASE_DATA} />);
    const root = document.querySelector("[data-case-label-root]");
    expect(root).not.toBeNull();
  });
});

// ─── Custom className ─────────────────────────────────────────────────────────

describe("CaseLabel — className prop", () => {
  it("appends a custom className to the wrapper", () => {
    render(<CaseLabel data={BASE_DATA} className="test-label-wrapper" />);
    const root = document.querySelector("[data-case-label-root]");
    expect(root!.className).toContain("test-label-wrapper");
  });
});
