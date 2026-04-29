/**
 * @vitest-environment jsdom
 *
 * Unit tests — LabelPageClient
 *
 * Verifies that the printable case label page:
 *   1. Renders a loading skeleton while the case query is in flight.
 *   2. Renders a "case not found" alert when the query resolves to null.
 *   3. Renders the CaseLabel preview when both the case query and the
 *      QR-code generation hook resolve.
 *   4. Renders a back-to-case link, a print button, and a size selector
 *      with three options (4×6 / 4×3 / 2×3.5).
 *   5. Wires the print button to the usePrintLabel triggerPrint callback.
 *   6. Tracks the selected label size on the rendered <CaseLabel>.
 *
 * The Convex client and the QR-generation hook are mocked so the test runs
 * fully in jsdom without Web Crypto or a network connection.
 */

import * as React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// next/link — render as a plain <a> so href shows up in the DOM
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    [key: string]: unknown;
  }) => (
    <a href={href} className={className} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
}));

// convex/react — controllable useQuery for the three queries the page uses
const queryByApi = new Map<unknown, unknown>();

const useQueryMock = vi.fn((api: unknown, _args: unknown) => {
  return queryByApi.get(api);
});

vi.mock("convex/react", () => ({
  useQuery: (api: unknown, args: unknown) => useQueryMock(api, args),
}));

// Convex generated API — stub object literals so vi.mock can return identifiable refs.
vi.mock("../../../../../../../convex/_generated/api", () => ({
  api: {
    cases: { getCaseById: { __ref: "cases.getCaseById" } },
    caseTemplates: {
      getCaseTemplateById: { __ref: "caseTemplates.getCaseTemplateById" },
    },
    missions: { getMissionById: { __ref: "missions.getMissionById" } },
  },
}));

// usePrintLabel — controllable QR state + triggerPrint spy
const triggerPrintSpy = vi.fn();
let mockQrState: {
  status: "idle" | "loading" | "ready" | "error";
  identifier?: string;
  payload?: string;
  svg?: string;
  dataUrl?: string;
  error?: Error;
} = {
  status: "ready",
  identifier: "CASE-4f3d1a9b2c7e5f0a",
  payload: "https://scan.example.com/case/abc123?uid=4f3d1a9b2c7e5f0a",
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="white"/></svg>',
  dataUrl: "data:image/png;base64,abc123",
};

vi.mock("@/hooks/use-print-label", () => ({
  usePrintLabel: () => ({
    qrState: mockQrState,
    triggerPrint: triggerPrintSpy,
    regenerate: vi.fn(),
    downloadAsPng: vi.fn().mockResolvedValue(undefined),
    downloadAsPdf: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { LabelPageClient } from "../LabelPageClient";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = "jx7abc000";

const READY_CASE_DOC = {
  _id: CASE_ID,
  _creationTime: 1700000000000,
  label: "CASE-001",
  qrCode: "https://scan.example.com/case/jx7abc000?uid=abc123",
  status: "deployed" as const,
  assigneeName: "Jane Pilot",
  locationName: "Grand Rapids, MI",
  notes: "Handle with care",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setQuery(apiRef: unknown, value: unknown) {
  queryByApi.set(apiRef, value);
}

function resetQuery() {
  queryByApi.clear();
}

// We import the mocked api to seed the query map by reference equality.
import { api } from "../../../../../../../convex/_generated/api";

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetQuery();
  triggerPrintSpy.mockClear();
  useQueryMock.mockClear();

  // Default: QR ready, case loading.
  mockQrState = {
    status: "ready",
    identifier: "CASE-4f3d1a9b2c7e5f0a",
    payload: "https://scan.example.com/case/abc123?uid=4f3d1a9b2c7e5f0a",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="white"/></svg>',
    dataUrl: "data:image/png;base64,abc123",
  };
});

afterEach(() => {
  cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LabelPageClient — loading state", () => {
  it("renders a loading skeleton when the case query is undefined", () => {
    setQuery(api.cases.getCaseById, undefined);

    render(<LabelPageClient caseId={CASE_ID} />);

    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(within(region).getByText(/loading case/i)).toBeTruthy();
    // The case ID is shown so the user can verify they navigated to the right URL.
    expect(within(region).getByText(CASE_ID)).toBeTruthy();
  });
});

describe("LabelPageClient — not-found state", () => {
  it("renders an alert when the case query resolves to null", () => {
    setQuery(api.cases.getCaseById, null);

    render(<LabelPageClient caseId={CASE_ID} />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/case not found/i)).toBeTruthy();
    expect(
      within(alert).getByRole("link", { name: /back to fleet registry/i }),
    ).toBeTruthy();
  });
});

describe("LabelPageClient — ready state", () => {
  beforeEach(() => {
    setQuery(api.cases.getCaseById, READY_CASE_DOC);
    setQuery(api.caseTemplates.getCaseTemplateById, null);
    setQuery(api.missions.getMissionById, null);
  });

  it("renders the case display label as the page title", () => {
    render(<LabelPageClient caseId={CASE_ID} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("CASE-001");
  });

  it("renders the QR code identifier inside the label preview", () => {
    render(<LabelPageClient caseId={CASE_ID} />);
    expect(screen.getByText("CASE-4f3d1a9b2c7e5f0a")).toBeTruthy();
  });

  it("renders the QR payload URL inside the label footer", () => {
    render(<LabelPageClient caseId={CASE_ID} />);
    expect(
      screen.getByText(
        "https://scan.example.com/case/abc123?uid=4f3d1a9b2c7e5f0a",
      ),
    ).toBeTruthy();
  });

  it("renders a back-to-case link with the correct deep-link URL", () => {
    render(<LabelPageClient caseId={CASE_ID} />);
    const link = screen.getByRole("link", {
      name: /back to case detail for case-001/i,
    });
    expect(link.getAttribute("href")).toBe(
      `/inventory?case=${encodeURIComponent(CASE_ID)}&panel=1`,
    );
  });

  it("renders the size selector with three options", () => {
    render(<LabelPageClient caseId={CASE_ID} />);
    const group = screen.getByRole("group", { name: /select label size/i });
    expect(group).toBeTruthy();

    // Three radio inputs (one per size)
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
  });

  it("defaults to the 4x6 size on the rendered label", () => {
    render(<LabelPageClient caseId={CASE_ID} />);
    const labelRoot = document.querySelector("[data-case-label-root]");
    expect(labelRoot).not.toBeNull();
    expect(labelRoot?.getAttribute("data-label-size")).toBe("4x6");
  });

  it("changes the rendered label size when a different option is selected", () => {
    render(<LabelPageClient caseId={CASE_ID} />);

    const compactRadio = screen.getByRole("radio", {
      name: /4 by 3 inch compact label/i,
    });
    fireEvent.click(compactRadio);

    const labelRoot = document.querySelector("[data-case-label-root]");
    expect(labelRoot?.getAttribute("data-label-size")).toBe("4x3");
  });

  it("renders a print button that invokes triggerPrint when clicked", () => {
    render(<LabelPageClient caseId={CASE_ID} />);
    const button = screen.getByRole("button", {
      name: /print label for case CASE-001/i,
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    expect(triggerPrintSpy).toHaveBeenCalledTimes(1);
  });

  it("renders the assignee and location metadata fields", () => {
    render(<LabelPageClient caseId={CASE_ID} />);
    expect(screen.getByText("Jane Pilot")).toBeTruthy();
    expect(screen.getByText("Grand Rapids, MI")).toBeTruthy();
  });

  it("renders the case notes when present", () => {
    render(<LabelPageClient caseId={CASE_ID} />);
    expect(screen.getByText("Handle with care")).toBeTruthy();
  });
});

describe("LabelPageClient — QR generation states", () => {
  beforeEach(() => {
    setQuery(api.cases.getCaseById, READY_CASE_DOC);
    setQuery(api.caseTemplates.getCaseTemplateById, null);
    setQuery(api.missions.getMissionById, null);
  });

  it("disables the print button while the QR code is loading", () => {
    mockQrState = { status: "loading" };
    render(<LabelPageClient caseId={CASE_ID} />);
    const button = screen.getByRole("button", {
      name: /print label for case CASE-001/i,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders an inline error banner when QR generation fails", () => {
    mockQrState = {
      status: "error",
      error: new Error("Web Crypto unavailable"),
    };
    render(<LabelPageClient caseId={CASE_ID} />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/could not generate the qr code/i)).toBeTruthy();
    expect(within(alert).getByText(/web crypto unavailable/i)).toBeTruthy();
  });
});
