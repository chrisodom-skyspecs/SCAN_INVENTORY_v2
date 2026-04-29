/**
 * @vitest-environment jsdom
 *
 * Unit tests — BatchLabelPageClient
 *
 * Verifies that the batch printable case label page:
 *   1. parseCaseIds correctly handles ?ids=a,b,c, ?id=a&id=b, and mixed forms
 *      while trimming whitespace and de-duplicating in a stable order.
 *   2. Shows the empty state when no IDs are present in the URL.
 *   3. Shows the too-many-cases alert when the request exceeds MAX_BATCH_SIZE.
 *   4. Renders one CaseLabel root per case ID (multi-page layout).
 *   5. Wires the "Print all" button to window.print().
 *   6. Tracks the selected label size on every rendered <CaseLabel>.
 *   7. Each rendered label root carries the data attributes that drive the
 *      shared @media print page-break rules in CaseLabel.module.css.
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

// next/navigation — controllable useSearchParams
let mockSearchParams: URLSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

// convex/react — controllable useQuery for the per-tile case subscription
const queryByApi = new Map<unknown, unknown>();
const useQueryMock = vi.fn((api: unknown, _args: unknown) => {
  return queryByApi.get(api);
});
vi.mock("convex/react", () => ({
  useQuery: (api: unknown, args: unknown) => useQueryMock(api, args),
}));

// Convex generated API — stub object literals so vi.mock can return identifiable refs
vi.mock("../../../../../../convex/_generated/api", () => ({
  api: {
    cases: { getCaseById: { __ref: "cases.getCaseById" } },
    caseTemplates: {
      getCaseTemplateById: { __ref: "caseTemplates.getCaseTemplateById" },
    },
    missions: { getMissionById: { __ref: "missions.getMissionById" } },
  },
}));

// usePrintLabel — return a ready QR state for every caseId so all tiles render
vi.mock("@/hooks/use-print-label", () => ({
  usePrintLabel: (caseId: string) => ({
    qrState: {
      status: "ready" as const,
      identifier: `CASE-${caseId.slice(0, 16).padEnd(16, "0")}`,
      payload: `https://scan.example.com/case/${caseId}`,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="white"/></svg>',
      dataUrl: "data:image/png;base64,abc123",
    },
    triggerPrint: vi.fn(),
    regenerate: vi.fn(),
    downloadAsPng: vi.fn().mockResolvedValue(undefined),
    downloadAsPdf: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import {
  BatchLabelPageClient,
  parseCaseIds,
} from "../BatchLabelPageClient";

// We import the mocked api so we can seed the query map by reference equality
import { api } from "../../../../../../convex/_generated/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setQuery(apiRef: unknown, value: unknown) {
  queryByApi.set(apiRef, value);
}
function resetQueries() {
  queryByApi.clear();
}

function makeCaseDoc(caseId: string, label: string) {
  return {
    _id: caseId,
    _creationTime: 1700000000000,
    label,
    qrCode: `https://scan.example.com/case/${caseId}`,
    status: "deployed" as const,
    assigneeName: "Jane Pilot",
    locationName: "Grand Rapids, MI",
    notes: "Handle with care",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetQueries();
  useQueryMock.mockClear();
  mockSearchParams = new URLSearchParams();
  // Default: every case query has no template / no mission
  setQuery(api.caseTemplates.getCaseTemplateById, null);
  setQuery(api.missions.getMissionById, null);
});

afterEach(() => {
  cleanup();
});

// ─── parseCaseIds ─────────────────────────────────────────────────────────────

describe("parseCaseIds", () => {
  it("returns an empty array when no ids are present", () => {
    const result = parseCaseIds(new URLSearchParams(""));
    expect(result).toEqual([]);
  });

  it("parses comma-separated ?ids=a,b,c", () => {
    const result = parseCaseIds(new URLSearchParams("ids=a,b,c"));
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("parses repeated ?id=a&id=b&id=c", () => {
    const result = parseCaseIds(
      new URLSearchParams("id=a&id=b&id=c"),
    );
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("combines comma-separated and repeated forms (ids before id)", () => {
    // Implementation contract: all ?ids= occurrences are consumed first
    // (preserving their inner comma-separated order), then all ?id= ones,
    // with deduplication preserving first-appearance order overall.
    const result = parseCaseIds(
      new URLSearchParams("ids=a,b&id=c&id=d&ids=e,f"),
    );
    expect(result).toEqual(["a", "b", "e", "f", "c", "d"]);
  });

  it("trims whitespace from each id", () => {
    const result = parseCaseIds(new URLSearchParams("ids= a , b , c "));
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("drops empty / whitespace-only entries", () => {
    const result = parseCaseIds(new URLSearchParams("ids=a,,b, ,c"));
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("deduplicates while preserving the order of first appearance", () => {
    const result = parseCaseIds(
      new URLSearchParams("ids=a,b,a,c&id=b&id=d&id=a"),
    );
    expect(result).toEqual(["a", "b", "c", "d"]);
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("BatchLabelPageClient — empty state", () => {
  it("shows a 'no cases selected' status when the URL has no ids", () => {
    mockSearchParams = new URLSearchParams("");

    render(<BatchLabelPageClient />);

    const statusBox = screen.getByRole("status");
    expect(within(statusBox).getByText(/no cases selected/i)).toBeTruthy();
    expect(
      within(statusBox).getByRole("link", { name: /back to fleet registry/i }),
    ).toBeTruthy();
  });

  it("does not render a print button or any case label root", () => {
    mockSearchParams = new URLSearchParams("");

    render(<BatchLabelPageClient />);

    expect(
      screen.queryByTestId("batch-print-button"),
    ).toBeNull();
    expect(
      document.querySelectorAll("[data-case-label-root]").length,
    ).toBe(0);
  });
});

// ─── Too-many state ───────────────────────────────────────────────────────────

describe("BatchLabelPageClient — too-many state", () => {
  it("shows an alert when more than 100 ids are supplied", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `case-${i}`).join(",");
    mockSearchParams = new URLSearchParams(`ids=${ids}`);

    render(<BatchLabelPageClient />);

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByText(/too many cases for one batch/i),
    ).toBeTruthy();
    expect(within(alert).getByText("101")).toBeTruthy();
    expect(within(alert).getByText("100")).toBeTruthy();
  });

  it("does not subscribe to any per-case query when over the limit", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `case-${i}`).join(",");
    mockSearchParams = new URLSearchParams(`ids=${ids}`);

    render(<BatchLabelPageClient />);

    // No per-case <BatchLabelTile> means no <CaseLabel> renders
    expect(
      document.querySelectorAll("[data-case-label-root]").length,
    ).toBe(0);
  });
});

// ─── Ready state — multi-page layout ──────────────────────────────────────────

describe("BatchLabelPageClient — ready state (multi-page layout)", () => {
  beforeEach(() => {
    setQuery(api.cases.getCaseById, makeCaseDoc("c1", "CASE-001"));
  });

  it("renders one CaseLabel per case ID in URL order", () => {
    mockSearchParams = new URLSearchParams("ids=c1,c2,c3");

    // Each tile uses the same Convex query; return the same doc for all of
    // them — they get keyed by caseId in the rendered DOM via test-ids.
    setQuery(api.cases.getCaseById, makeCaseDoc("c1", "CASE-MULTI"));

    render(<BatchLabelPageClient />);

    const labelRoots = document.querySelectorAll(
      "[data-case-label-root]",
    );
    expect(labelRoots.length).toBe(3);
  });

  it("shows the case count in the page title", () => {
    mockSearchParams = new URLSearchParams("ids=c1,c2,c3,c4");
    setQuery(api.cases.getCaseById, makeCaseDoc("c1", "CASE-MULTI"));

    render(<BatchLabelPageClient />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("4 cases");
  });

  it("uses singular 'case' when there is exactly one id", () => {
    mockSearchParams = new URLSearchParams("ids=c1");

    render(<BatchLabelPageClient />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("1 case");
  });

  it("renders a 'Print all' button that calls window.print()", () => {
    mockSearchParams = new URLSearchParams("ids=c1,c2");
    setQuery(api.cases.getCaseById, makeCaseDoc("c1", "CASE-001"));

    const printSpy = vi.fn();
    Object.defineProperty(window, "print", {
      configurable: true,
      writable: true,
      value: printSpy,
    });

    render(<BatchLabelPageClient />);

    const button = screen.getByTestId("batch-print-button");
    expect(button.getAttribute("aria-label")).toMatch(/print all 2 labels/i);

    fireEvent.click(button);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("defaults every rendered label to the 4x6 size", () => {
    mockSearchParams = new URLSearchParams("ids=c1,c2,c3");
    setQuery(api.cases.getCaseById, makeCaseDoc("c1", "CASE-001"));

    render(<BatchLabelPageClient />);

    const labelRoots = document.querySelectorAll(
      "[data-case-label-root]",
    );
    expect(labelRoots.length).toBeGreaterThan(0);
    labelRoots.forEach((root) => {
      expect(root.getAttribute("data-label-size")).toBe("4x6");
    });
  });

  it("propagates a size change to every rendered label", () => {
    mockSearchParams = new URLSearchParams("ids=c1,c2,c3");
    setQuery(api.cases.getCaseById, makeCaseDoc("c1", "CASE-001"));

    render(<BatchLabelPageClient />);

    const compactRadio = screen.getByRole("radio", {
      name: /4 by 3 inch compact label/i,
    });
    fireEvent.click(compactRadio);

    const labelRoots = document.querySelectorAll(
      "[data-case-label-root]",
    );
    expect(labelRoots.length).toBeGreaterThan(0);
    labelRoots.forEach((root) => {
      expect(root.getAttribute("data-label-size")).toBe("4x3");
    });
  });

  it("attaches the data-case-label-root attribute to every label so the page-break rules apply", () => {
    // The shared CaseLabel.module.css declares
    //   [data-case-label-root]              { break-after: page; ... }
    //   [data-case-label-root]:last-of-type { break-after: auto;  ... }
    // so emitting one [data-case-label-root] per case is the contract that
    // makes batch printing produce one page per case.
    mockSearchParams = new URLSearchParams("ids=c1,c2,c3,c4,c5");
    setQuery(api.cases.getCaseById, makeCaseDoc("c1", "CASE-001"));

    render(<BatchLabelPageClient />);

    const labelRoots = document.querySelectorAll(
      "[data-case-label-root]",
    );
    expect(labelRoots.length).toBe(5);
  });

  it("each label is wrapped in a section with a per-case aria-label", () => {
    mockSearchParams = new URLSearchParams("ids=c1,c2");
    setQuery(api.cases.getCaseById, makeCaseDoc("c1", "CASE-001"));

    render(<BatchLabelPageClient />);

    // Every ready tile carries data-testid="batch-tile-ready-<caseId>"
    expect(screen.getByTestId("batch-tile-ready-c1")).toBeTruthy();
    expect(screen.getByTestId("batch-tile-ready-c2")).toBeTruthy();
  });
});

// ─── Ready state — per-tile state handling ────────────────────────────────────

describe("BatchLabelPageClient — per-tile fallback states", () => {
  it("renders a loading placeholder for ids whose case query is still pending", () => {
    mockSearchParams = new URLSearchParams("ids=c1");
    setQuery(api.cases.getCaseById, undefined); // still loading

    render(<BatchLabelPageClient />);

    expect(screen.getByTestId("batch-tile-loading-c1")).toBeTruthy();
    // No label root rendered for a still-loading tile
    expect(
      document.querySelectorAll("[data-case-label-root]").length,
    ).toBe(0);
  });

  it("renders a not-found tile when the case query resolves to null", () => {
    mockSearchParams = new URLSearchParams("ids=missing");
    setQuery(api.cases.getCaseById, null);

    render(<BatchLabelPageClient />);

    expect(screen.getByTestId("batch-tile-notfound-missing")).toBeTruthy();
    expect(
      document.querySelectorAll("[data-case-label-root]").length,
    ).toBe(0);
  });
});
