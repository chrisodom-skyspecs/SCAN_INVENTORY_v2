/**
 * @vitest-environment jsdom
 *
 * Unit tests for T1Overview — Case Summary Panel.
 *
 * Sub-AC 3: Verifies that the FedEx TrackingStatus component is correctly
 * integrated into the T1 Summary panel in compact mode, wired to the Convex
 * queries for live tracking data via useFedExTracking.
 *
 * Test strategy
 * ─────────────
 * • All Convex hooks and custom hooks are mocked to control every data state.
 * • TrackingStatus is mocked as a transparent stub capturing received props.
 * • Heavy sub-components (T1MapPanel, T1TimelinePanel, LabelManagementPanel,
 *   CustodySection, etc.) are mocked to isolate T1Overview behavior.
 *
 * Coverage matrix
 * ───────────────
 *
 * Loading state:
 *   ✓ renders loading wrapper when caseDoc is undefined
 *   ✓ does not render t1-overview-right when loading
 *
 * Not-found state:
 *   ✓ renders "Case not found" message when caseDoc is null
 *
 * Tracking section — TrackingStatus integration (Sub-AC 3):
 *   ✓ renders TrackingStatus with variant="compact" when tracking exists
 *   ✓ passes caseId to TrackingStatus
 *   ✓ passes shipment prop in controlled mode
 *   ✓ passes liveTracking=null when no refresh has occurred
 *   ✓ passes live tracking data when available
 *   ✓ passes isRefreshing=true during refresh
 *   ✓ passes isActiveShipment to TrackingStatus
 *   ✓ passes refreshError when set
 *   ✓ does NOT render TrackingStatus section when hasTracking=false
 *   ✓ does NOT render TrackingStatus section when latestShipment=null
 *   ✓ onViewDetails callback is passed to TrackingStatus as onViewDetails
 *
 * TrackingStatus section structure:
 *   ✓ renders "Shipment Tracking" section heading when tracking exists
 *   ✓ wraps TrackingStatus in aria-label="Shipment tracking summary"
 *
 * Real-time data contract:
 *   ✓ useFedExTracking is called with the provided caseId
 *
 * Case metadata display:
 *   ✓ renders case label
 *   ✓ renders "Assigned to" metadata
 *   ✓ renders "Last updated" timestamp
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock Convex hooks ────────────────────────────────────────────────────────

const mockUseQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useAction: vi.fn(() => vi.fn()),
  useMutation: vi.fn(() => vi.fn()),
}));

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
vi.mock("../../../queries/checklist", () => ({
  useChecklistSummary: (...args: unknown[]) => mockUseChecklistSummary(...args),
}));

const mockUseDamageReportSummary = vi.fn();
vi.mock("../../../hooks/use-damage-reports", () => ({
  useDamageReportSummary: (...args: unknown[]) => mockUseDamageReportSummary(...args),
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
        data-has-on-view-details={props.onViewDetails ? "true" : "false"}
      />
    );
  },
}));

// T1Shell — pass-through stub rendering both panels
vi.mock("../T1Shell", () => ({
  default: ({
    leftPanel,
    rightPanel,
  }: {
    leftPanel: React.ReactNode;
    rightPanel: React.ReactNode;
  }) => (
    <div data-testid="t1-shell">
      <div data-testid="t1-left">{leftPanel}</div>
      <div data-testid="t1-right">{rightPanel}</div>
    </div>
  ),
}));

// T1MapPanel — stub
vi.mock("../T1MapPanel", () => ({
  T1MapPanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="t1-map-panel" data-case-id={caseId} />
  ),
}));

// T1TimelinePanel — stub
vi.mock("../T1TimelinePanel", () => ({
  T1TimelinePanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="t1-timeline-panel" data-case-id={caseId} />
  ),
}));

// CustodySection — stub
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

// InlineStatusEditor — stub
vi.mock("../InlineStatusEditor", () => ({
  InlineStatusEditor: ({ caseId }: { caseId: string }) => (
    <div data-testid="inline-status-editor" data-case-id={caseId} />
  ),
}));

// InlineHolderEditor — stub
vi.mock("../InlineHolderEditor", () => ({
  InlineHolderEditor: ({ caseId }: { caseId: string }) => (
    <div data-testid="inline-holder-editor" data-case-id={caseId} />
  ),
}));

// StatusPill — transparent stub
vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind}>{kind}</span>
  ),
}));

// Import SUT after mocks
import T1Overview from "../T1Overview";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = "case-t1-001" as const;

const MOCK_CASE_DOC = {
  _id: CASE_ID,
  _creationTime: 1_700_000_000_000,
  label: "Drone Case Bravo",
  status: "deployed",
  qrCode: "QR-002",
  locationName: "Site Alpha",
  assigneeName: "Bob Technician",
  notes: "Handle with care.",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
};

function makeShipment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "ship-t1-001",
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

function makeFedExTrackingResult(overrides: Partial<Record<string, unknown>> = {}) {
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

  // Default: caseDoc loaded, tracking present
  mockUseQuery.mockReturnValue(MOCK_CASE_DOC);
  mockUseFedExTracking.mockReturnValue(makeFedExTrackingResult());
  mockUseChecklistSummary.mockReturnValue(undefined);
  mockUseDamageReportSummary.mockReturnValue(undefined);
  mockUseCurrentUser.mockReturnValue({ can: () => false });
});

afterEach(() => {
  cleanup();
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("T1Overview — loading state", () => {
  it("renders loading wrapper when caseDoc is undefined", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { container } = render(<T1Overview caseId={CASE_ID} />);
    const loading = container.querySelector("[aria-busy='true']");
    expect(loading).not.toBeNull();
  });

  it("does not render t1-overview-right when caseDoc is undefined", () => {
    mockUseQuery.mockReturnValue(undefined);
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.queryByTestId("t1-overview-right")).toBeNull();
  });
});

// ─── Not-found state ──────────────────────────────────────────────────────────

describe("T1Overview — case not found", () => {
  it("renders 'Case not found' message when caseDoc is null", () => {
    mockUseQuery.mockReturnValue(null);
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.getByText("Case not found")).toBeTruthy();
  });
});

// ─── TrackingStatus integration (Sub-AC 3) ───────────────────────────────────

describe("T1Overview — TrackingStatus compact integration (Sub-AC 3)", () => {
  it("renders TrackingStatus when tracking exists", () => {
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.getByTestId("tracking-status")).toBeTruthy();
  });

  it('renders TrackingStatus with variant="compact"', () => {
    render(<T1Overview caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-variant")).toBe("compact");
  });

  it("passes the caseId to TrackingStatus", () => {
    render(<T1Overview caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-case-id")).toBe(CASE_ID);
  });

  it("passes the shipment prop in controlled mode (avoids duplicate subscription)", () => {
    render(<T1Overview caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-has-shipment")).toBe("true");
  });

  it("passes liveTracking=null when no refresh has occurred", () => {
    render(<T1Overview caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-has-live-tracking")).toBe("false");
  });

  it("passes live tracking data when available", () => {
    const liveTracking = {
      trackingNumber: "794644823741",
      status: "in_transit",
      description: "Package in transit",
      estimatedDelivery: "2025-06-03T20:00:00Z",
      events: [],
    };
    mockUseFedExTracking.mockReturnValue(
      makeFedExTrackingResult({ liveTracking })
    );
    render(<T1Overview caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-has-live-tracking")).toBe("true");
  });

  it("passes isRefreshing=true during refresh", () => {
    mockUseFedExTracking.mockReturnValue(
      makeFedExTrackingResult({ isRefreshing: true })
    );
    render(<T1Overview caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-is-refreshing")).toBe("true");
  });

  it("passes isActiveShipment to TrackingStatus", () => {
    mockUseFedExTracking.mockReturnValue(
      makeFedExTrackingResult({ isActiveShipment: false })
    );
    render(<T1Overview caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-is-active")).toBe("false");
  });

  it("passes refreshError to TrackingStatus when set", () => {
    mockUseFedExTracking.mockReturnValue(
      makeFedExTrackingResult({ refreshError: "RATE_LIMITED: too many requests" })
    );
    render(<T1Overview caseId={CASE_ID} />);
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-refresh-error")).toBe(
      "RATE_LIMITED: too many requests"
    );
  });

  it("does NOT render TrackingStatus when hasTracking=false", () => {
    mockUseFedExTracking.mockReturnValue(
      makeFedExTrackingResult({
        hasTracking: false,
        latestShipment: null,
        shipments: [],
      })
    );
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.queryByTestId("tracking-status")).toBeNull();
  });

  it("does NOT render TrackingStatus when latestShipment=null", () => {
    mockUseFedExTracking.mockReturnValue(
      makeFedExTrackingResult({
        hasTracking: false,
        latestShipment: null,
        shipments: [],
      })
    );
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.queryByTestId("tracking-status")).toBeNull();
  });

  it("passes onViewDetails callback to TrackingStatus as onViewDetails", () => {
    const onNavigate = vi.fn();
    render(
      <T1Overview caseId={CASE_ID} onNavigateToShipping={onNavigate} />
    );
    const ts = screen.getByTestId("tracking-status");
    expect(ts.getAttribute("data-has-on-view-details")).toBe("true");
  });

  it("calls useFedExTracking with the provided caseId", () => {
    render(<T1Overview caseId={CASE_ID} />);
    expect(mockUseFedExTracking).toHaveBeenCalledWith(CASE_ID);
  });
});

// ─── Tracking section structure ───────────────────────────────────────────────

describe("T1Overview — tracking section structure", () => {
  it("renders 'Shipment Tracking' heading when tracking exists", () => {
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.getByText("Shipment Tracking")).toBeTruthy();
  });

  it("wraps TrackingStatus in section with aria-label='Shipment tracking summary'", () => {
    render(<T1Overview caseId={CASE_ID} />);
    const section = screen.getByRole("region", {
      name: "Shipment tracking summary",
    });
    expect(section).toBeTruthy();
    // TrackingStatus stub should be inside this section
    expect(section.querySelector("[data-testid='tracking-status']")).not.toBeNull();
  });

  it("does NOT render 'Shipment Tracking' heading when no tracking", () => {
    mockUseFedExTracking.mockReturnValue(
      makeFedExTrackingResult({
        hasTracking: false,
        latestShipment: null,
        shipments: [],
      })
    );
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.queryByText("Shipment Tracking")).toBeNull();
  });
});

// ─── Case metadata display ────────────────────────────────────────────────────

describe("T1Overview — case metadata", () => {
  it("renders the case label", () => {
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.getByText("Drone Case Bravo")).toBeTruthy();
  });

  it("renders 'Assigned to' metadata label", () => {
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.getByText("Assigned to")).toBeTruthy();
  });

  it("renders 'Last updated' metadata label", () => {
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.getByText("Last updated")).toBeTruthy();
  });

  it("renders the T1 shell layout", () => {
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.getByTestId("t1-shell")).toBeTruthy();
  });
});
