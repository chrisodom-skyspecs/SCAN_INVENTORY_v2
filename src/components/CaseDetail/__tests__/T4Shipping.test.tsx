/**
 * @vitest-environment jsdom
 *
 * Unit tests for T4Shipping — Shipping & Custody Chain Panel.
 *
 * Sub-AC 3: Verifies that the FedEx TrackingStatus component is correctly
 * integrated into the T4 Shipping panel, wired to the Convex queries for
 * live tracking data via useFedExTracking and useCaseShipmentAndCustody.
 *
 * Test strategy
 * ─────────────
 * • All Convex hooks (useQuery, useAction) and custom hooks are mocked so
 *   we can control every data state without a live Convex environment.
 * • TrackingStatus is mocked as a transparent stub so we can assert on
 *   which props it receives (caseId, variant, shipment, liveTracking, etc.)
 *   without rendering its internal CSS module dependencies.
 * • CustodySection, InspectionSummaryBanner sub-components are mocked to
 *   isolate T4Shipping behavior.
 *
 * Coverage matrix
 * ───────────────
 *
 * Loading state:
 *   ✓ renders spinner when shipments are undefined (Convex query loading)
 *   ✓ renders spinner when caseDoc is undefined
 *
 * No-tracking state:
 *   ✓ renders NoShipmentPlaceholder when hasTracking is false
 *   ✓ renders NoShipmentPlaceholder when latestShipment is null
 *
 * Tracking present — TrackingStatus integration:
 *   ✓ renders TrackingStatus with variant="full" when tracking exists
 *   ✓ passes caseId to TrackingStatus
 *   ✓ passes latestShipment to TrackingStatus (controlled mode)
 *   ✓ passes liveTracking to TrackingStatus
 *   ✓ passes isRefreshing to TrackingStatus
 *   ✓ passes isActiveShipment to TrackingStatus
 *   ✓ passes refreshError to TrackingStatus
 *   ✓ does NOT render TrackingStatus when hasTracking=false
 *
 * Summary badges (useCaseShipmentAndCustody):
 *   ✓ renders "2 shipments" badge when totalShipments=2
 *   ✓ renders "1 handoff" badge when totalHandoffs=1
 *   ✓ renders "Held by: Alice" badge when currentCustodian is set
 *   ✓ does NOT render badge row when no data
 *
 * Case context header:
 *   ✓ renders case label from caseDoc
 *   ✓ renders StatusPill with caseDoc.status kind
 *
 * Shipment history:
 *   ✓ renders ShipmentHistory section when multiple shipments exist
 *   ✓ does NOT render ShipmentHistory when only one shipment
 *
 * Real-time data contract:
 *   ✓ useFedExTracking is called with the provided caseId
 *   ✓ useCaseShipmentAndCustody is called with the provided caseId
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock Convex hooks ────────────────────────────────────────────────────────

// useQuery — returns caseDoc
const mockUseQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useAction: vi.fn(() => vi.fn()),
}));

// convex/_generated/api stubs
vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    cases: { getCaseById: "cases.getCaseById" },
    shipping: {
      listShipmentsByCase: "shipping.listShipmentsByCase",
      trackShipment: "shipping.trackShipment",
    },
  },
}));

// ─── Mock custom hooks ────────────────────────────────────────────────────────

const mockUseFedExTracking = vi.fn();
vi.mock("../../../hooks/use-fedex-tracking", () => ({
  useFedExTracking: (...args: unknown[]) => mockUseFedExTracking(...args),
}));

const mockUseChecklistSummary = vi.fn();
vi.mock("../../../hooks/use-checklist", () => ({
  useChecklistSummary: (...args: unknown[]) => mockUseChecklistSummary(...args),
}));

const mockUseDamageReportSummary = vi.fn();
const mockUseDamageReportsByCase = vi.fn();
vi.mock("../../../hooks/use-damage-reports", () => ({
  useDamageReportSummary: (...args: unknown[]) => mockUseDamageReportSummary(...args),
  useDamageReportsByCase: (...args: unknown[]) => mockUseDamageReportsByCase(...args),
}));

const mockUseCaseShipmentAndCustody = vi.fn();
vi.mock("../../../hooks/use-shipment-status", () => ({
  useCaseShipmentAndCustody: (...args: unknown[]) =>
    mockUseCaseShipmentAndCustody(...args),
}));

const mockUseCurrentUser = vi.fn();
vi.mock("../../../hooks/use-current-user", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock("../../../../convex/rbac", () => ({
  OPERATIONS: { QR_CODE_GENERATE: "qrCode:generate" },
}));

// ─── Mock sub-components ──────────────────────────────────────────────────────

// TrackingStatus — transparent stub capturing received props
const mockTrackingStatus = vi.fn();
vi.mock("../../TrackingStatus", () => ({
  TrackingStatus: (props: Record<string, unknown>) => {
    mockTrackingStatus(props);
    return (
      <div
        data-testid="tracking-status"
        data-variant={props.variant as string}
        data-case-id={props.caseId as string}
        data-has-shipment={props.shipment ? "true" : "false"}
        data-is-refreshing={String(props.isRefreshing)}
        data-is-active={String(props.isActiveShipment)}
        data-refresh-error={props.refreshError as string ?? ""}
        data-has-live-tracking={props.liveTracking ? "true" : "false"}
      />
    );
  },
}));

// CustodySection — stub to avoid custody deps
vi.mock("../CustodySection", () => ({
  default: ({ caseId, variant }: { caseId: string; variant: string }) => (
    <div
      data-testid="custody-section"
      data-case-id={caseId}
      data-variant={variant}
    />
  ),
}));

// LabelManagementPanel — stub
vi.mock("../../LabelManagementPanel", () => ({
  LabelManagementPanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="label-panel" data-case-id={caseId} />
  ),
}));

// StatusPill — transparent stub
vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind}>{kind}</span>
  ),
}));

// Import SUT after all mocks
import T4Shipping from "../T4Shipping";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = "case-t4-001" as const;

const MOCK_CASE_DOC = {
  _id: CASE_ID,
  _creationTime: 1_700_000_000_000,
  label: "Drone Case Alpha",
  status: "in_transit",
  qrCode: "QR-001",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

function makeShipment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "ship-001",
    _creationTime: 1_700_001_000_000,
    caseId: CASE_ID,
    trackingNumber: "794644823741",
    carrier: "FedEx",
    status: "in_transit",
    createdAt: 1_700_001_000_000,
    updatedAt: 1_700_001_000_000,
    ...overrides,
  };
}

function makeUseFedExTrackingResult(overrides: Partial<Record<string, unknown>> = {}) {
  const shipment = makeShipment();
  return {
    shipments: [shipment],
    latestShipment: shipment,
    hasTracking: true,
    isActiveShipment: true,
    liveTracking: null,
    isRefreshing: false,
    refreshError: null,
    refreshErrorCode: null,
    refreshErrorMessage: null,
    refreshTracking: vi.fn(),
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: case doc and shipments loaded, has tracking
  mockUseQuery.mockReturnValue(MOCK_CASE_DOC);
  mockUseFedExTracking.mockReturnValue(makeUseFedExTrackingResult());
  mockUseChecklistSummary.mockReturnValue(undefined);
  mockUseDamageReportSummary.mockReturnValue(undefined);
  mockUseDamageReportsByCase.mockReturnValue(undefined);
  mockUseCaseShipmentAndCustody.mockReturnValue(undefined);
  mockUseCurrentUser.mockReturnValue({ can: () => false });
});

afterEach(() => {
  cleanup();
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("T4Shipping — loading state", () => {
  it("renders spinner when shipments are undefined (Convex query loading)", () => {
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({ shipments: undefined })
    );
    const { container } = render(<T4Shipping caseId={CASE_ID} />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByTestId("t4-shipping")).toBeNull();
  });

  it("renders spinner when caseDoc is undefined (Convex query loading)", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { container } = render(<T4Shipping caseId={CASE_ID} />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByTestId("t4-shipping")).toBeNull();
  });
});

// ─── No-tracking state ────────────────────────────────────────────────────────

describe("T4Shipping — no tracking state", () => {
  it("renders NoShipmentPlaceholder when hasTracking is false", () => {
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({
        hasTracking: false,
        latestShipment: null,
        shipments: [],
      })
    );
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.getByTestId("no-shipment-placeholder")).toBeTruthy();
    expect(screen.queryByTestId("tracking-status")).toBeNull();
  });

  it("renders NoShipmentPlaceholder when latestShipment is null", () => {
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({
        hasTracking: false,
        latestShipment: null,
        shipments: [],
      })
    );
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.getByTestId("no-shipment-placeholder")).toBeTruthy();
  });

  it("NoShipmentPlaceholder shows correct text", () => {
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({
        hasTracking: false,
        latestShipment: null,
        shipments: [],
      })
    );
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.getByText("No shipment recorded")).toBeTruthy();
    expect(screen.getByText(/No FedEx tracking number/)).toBeTruthy();
  });
});

// ─── TrackingStatus integration (Sub-AC 3) ───────────────────────────────────

describe("T4Shipping — TrackingStatus integration (Sub-AC 3)", () => {
  it("renders TrackingStatus when tracking exists", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.getByTestId("tracking-status")).toBeTruthy();
  });

  it('renders TrackingStatus with variant="full"', () => {
    render(<T4Shipping caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-variant")).toBe("full");
  });

  it("passes the caseId to TrackingStatus", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-case-id")).toBe(CASE_ID);
  });

  it("passes the shipment prop to TrackingStatus (controlled mode)", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-has-shipment")).toBe("true");
  });

  it("passes liveTracking=null when no live refresh has occurred", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-has-live-tracking")).toBe("false");
  });

  it("passes live tracking data to TrackingStatus after refresh", () => {
    const liveTracking = {
      trackingNumber: "794644823741",
      status: "in_transit",
      description: "In transit to destination",
      estimatedDelivery: "2025-06-03T20:00:00Z",
      events: [],
    };
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({ liveTracking })
    );
    render(<T4Shipping caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-has-live-tracking")).toBe("true");
  });

  it("passes isRefreshing=true to TrackingStatus during refresh", () => {
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({ isRefreshing: true })
    );
    render(<T4Shipping caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-is-refreshing")).toBe("true");
  });

  it("passes isActiveShipment=true for non-delivered shipment", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-is-active")).toBe("true");
  });

  it("passes isActiveShipment=false for delivered shipment", () => {
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({
        isActiveShipment: false,
        latestShipment: makeShipment({ status: "delivered" }),
      })
    );
    render(<T4Shipping caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-is-active")).toBe("false");
  });

  it("passes refreshError to TrackingStatus when set", () => {
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({ refreshError: "NOT_FOUND: tracking number not found" })
    );
    render(<T4Shipping caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-refresh-error")).toBe(
      "NOT_FOUND: tracking number not found"
    );
  });

  it("does NOT render TrackingStatus when hasTracking=false", () => {
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({
        hasTracking: false,
        latestShipment: null,
        shipments: [],
      })
    );
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.queryByTestId("tracking-status")).toBeNull();
  });

  it("calls useFedExTracking with the provided caseId", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    expect(mockUseFedExTracking).toHaveBeenCalledWith(CASE_ID);
  });
});

// ─── Summary badges (useCaseShipmentAndCustody) ───────────────────────────────

describe("T4Shipping — summary badges (Sub-AC 3 combined query)", () => {
  it("renders '2 shipments' badge when totalShipments=2", () => {
    mockUseCaseShipmentAndCustody.mockReturnValue({
      caseId: CASE_ID,
      latestShipment: makeShipment(),
      currentCustodian: null,
      totalShipments: 2,
      totalHandoffs: 0,
    });
    render(<T4Shipping caseId={CASE_ID} />);
    const badgeArea = screen.getByTestId("t4-summary-badges");
    expect(badgeArea.textContent).toContain("2 shipments");
  });

  it("renders '1 shipment' (singular) badge when totalShipments=1", () => {
    mockUseCaseShipmentAndCustody.mockReturnValue({
      caseId: CASE_ID,
      latestShipment: makeShipment(),
      currentCustodian: null,
      totalShipments: 1,
      totalHandoffs: 0,
    });
    render(<T4Shipping caseId={CASE_ID} />);
    const badgeArea = screen.getByTestId("t4-summary-badges");
    expect(badgeArea.textContent).toContain("1 shipment");
    expect(badgeArea.textContent).not.toContain("1 shipments");
  });

  it("renders '1 handoff' badge when totalHandoffs=1", () => {
    mockUseCaseShipmentAndCustody.mockReturnValue({
      caseId: CASE_ID,
      latestShipment: makeShipment(),
      currentCustodian: {
        _id: "custody-001",
        caseId: CASE_ID,
        fromUserId: "user-a",
        fromUserName: "Bob",
        toUserId: "user-b",
        toUserName: "Alice",
        transferredAt: 1_700_002_000_000,
      },
      totalShipments: 1,
      totalHandoffs: 1,
    });
    render(<T4Shipping caseId={CASE_ID} />);
    const badgeArea = screen.getByTestId("t4-summary-badges");
    expect(badgeArea.textContent).toContain("1 handoff");
    expect(badgeArea.textContent).not.toContain("1 handoffs");
  });

  it("renders 'Held by: Alice' badge when currentCustodian is set", () => {
    mockUseCaseShipmentAndCustody.mockReturnValue({
      caseId: CASE_ID,
      latestShipment: makeShipment(),
      currentCustodian: {
        _id: "custody-001",
        caseId: CASE_ID,
        fromUserId: "user-a",
        fromUserName: "Bob",
        toUserId: "user-b",
        toUserName: "Alice",
        transferredAt: 1_700_002_000_000,
      },
      totalShipments: 1,
      totalHandoffs: 1,
    });
    render(<T4Shipping caseId={CASE_ID} />);
    const badgeArea = screen.getByTestId("t4-summary-badges");
    expect(badgeArea.textContent).toContain("Held by: Alice");
  });

  it("does NOT render badges row when combinedStatus is undefined and shipments empty", () => {
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({
        shipments: [],
        hasTracking: false,
        latestShipment: null,
      })
    );
    mockUseCaseShipmentAndCustody.mockReturnValue(undefined);
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.queryByTestId("t4-summary-badges")).toBeNull();
  });

  it("calls useCaseShipmentAndCustody with the provided caseId", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    expect(mockUseCaseShipmentAndCustody).toHaveBeenCalledWith(CASE_ID);
  });
});

// ─── Case context header ──────────────────────────────────────────────────────

describe("T4Shipping — case context header", () => {
  it("renders the case label from caseDoc", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.getByText("Drone Case Alpha")).toBeTruthy();
  });

  it("renders StatusPill with caseDoc.status kind", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    // First pill should be the case status pill in the context header
    const caseStatusPill = pills.find(
      (p) => p.getAttribute("data-kind") === "in_transit"
    );
    expect(caseStatusPill).toBeTruthy();
  });

  it("renders the main panel testid", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.getByTestId("t4-shipping")).toBeTruthy();
  });
});

// ─── Shipment history ─────────────────────────────────────────────────────────

describe("T4Shipping — shipment history", () => {
  it("renders 'All Shipments' section when multiple shipments exist", () => {
    const ship1 = makeShipment({ _id: "ship-001", createdAt: 1_700_001_000_000 });
    const ship2 = makeShipment({ _id: "ship-002", createdAt: 1_700_002_000_000 });
    mockUseFedExTracking.mockReturnValue(
      makeUseFedExTrackingResult({
        shipments: [ship2, ship1],
        latestShipment: ship2,
      })
    );
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.getByText("All Shipments")).toBeTruthy();
  });

  it("does NOT render 'All Shipments' section when only one shipment", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.queryByText("All Shipments")).toBeNull();
  });
});

// ─── Custody section ──────────────────────────────────────────────────────────

describe("T4Shipping — custody section", () => {
  it("renders CustodySection with variant='recent'", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    const custody = screen.getByTestId("custody-section");
    expect(custody.getAttribute("data-variant")).toBe("recent");
    expect(custody.getAttribute("data-case-id")).toBe(CASE_ID);
  });
});

// ─── Tracking section ARIA ────────────────────────────────────────────────────

describe("T4Shipping — ARIA and accessibility", () => {
  it("wraps TrackingStatus in a region with aria-label='Current shipment tracking'", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    const region = screen.getByRole("region", { name: "Current shipment tracking" });
    expect(region).toBeTruthy();
  });

  it("has a 'Tracking' section title in the tracking region", () => {
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.getByText("Tracking")).toBeTruthy();
  });
});
