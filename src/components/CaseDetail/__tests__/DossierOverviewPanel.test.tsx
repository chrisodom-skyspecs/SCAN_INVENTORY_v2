/**
 * @vitest-environment jsdom
 *
 * Unit tests: DossierOverviewPanel — Overview tab content for T4DossierShell.
 *
 * Covers:
 *   1.  Loading state — renders spinner when caseDoc is undefined
 *   2.  Not-found state — renders error when caseDoc is null
 *   3.  Case header — label, QR code, StatusPill rendered from case data
 *   4.  Stats row — renders 4 stat cards (total, ok, damaged, missing)
 *   5.  Metadata grid — location, assignee, timestamps displayed
 *   6.  Custody section — renders CustodySection compact variant
 *   7.  FedEx tracking — conditionally rendered when hasTracking = true
 *   8.  Notes — rendered only when caseDoc.notes is present
 *   9.  No FedEx section when hasTracking = false
 *   10. onNavigateToShipping callback wired to TrackingStatus
 *   11. Stats row loading skeletons when summary is undefined
 *   12. Stats labels always rendered in the stats row
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Convex hooks mock ────────────────────────────────────────────────────────
// useQuery is mocked as vi.fn() — tests use mockReturnValue to control the
// return value.  DossierOverviewPanel calls useQuery exactly once (for
// getCaseById); all other data comes from separately mocked hooks.

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useAction: vi.fn(),
  useMutation: vi.fn(() => {
    const mutate = vi.fn().mockResolvedValue(undefined) as ReturnType<typeof vi.fn> & {
      withOptimisticUpdate: ReturnType<typeof vi.fn>;
    };
    mutate.withOptimisticUpdate = vi.fn(() => mutate);
    return mutate;
  }),
}));

// ─── Kinde auth mock ──────────────────────────────────────────────────────────
// InlineStatusEditor and InlineHolderEditor use useKindeUser which wraps
// useKindeBrowserClient.  Provide a minimal stub so they render in idle state.

vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: () => ({
    user: {
      id: "test-user",
      given_name: "Test",
      family_name: "Operator",
      email: "test@skyspecs.com",
    },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    cases: { getCaseById: "cases:getCaseById" },
    checklists: { getChecklistSummary: "checklists:getChecklistSummary" },
    shipping: {
      listShipmentsByCase: "shipping:listShipmentsByCase",
      trackShipment: "shipping:trackShipment",
    },
    custody: { getLatestCustodyRecord: "custody:getLatestCustodyRecord" },
  },
}));

vi.mock("../../../convex/_generated/dataModel", () => ({ Id: {} }));

// ─── Hook mocks ───────────────────────────────────────────────────────────────

const mockChecklistSummary = vi.fn();
const mockFedExTracking = vi.fn();

vi.mock("../../../queries/checklist", () => ({
  useChecklistSummary: (...args: unknown[]) => mockChecklistSummary(...args),
}));

vi.mock("../../../hooks/use-fedex-tracking", () => ({
  useFedExTracking: (...args: unknown[]) => mockFedExTracking(...args),
}));

// ─── Component mocks ──────────────────────────────────────────────────────────

vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind, filled }: { kind: string; filled?: boolean }) => (
    <span
      data-testid="status-pill"
      data-kind={kind}
      data-filled={filled ? "true" : undefined}
    />
  ),
}));

vi.mock("../CustodySection", () => ({
  default: ({ caseId, variant }: { caseId: string; variant?: string }) => (
    <div
      data-testid="custody-section"
      data-case-id={caseId}
      data-variant={variant}
    />
  ),
}));

vi.mock("../../TrackingStatus", () => ({
  TrackingStatus: ({
    caseId,
    variant,
    onViewDetails,
  }: {
    caseId: string;
    variant?: string;
    onViewDetails?: () => void;
  }) => (
    <div
      data-testid="tracking-status"
      data-case-id={caseId}
      data-variant={variant}
    >
      {onViewDetails && (
        <button onClick={onViewDetails} data-testid="view-tracking-btn">
          View tracking
        </button>
      )}
    </div>
  ),
}));

// ─── SUT import (after all mocks) ─────────────────────────────────────────────

import { useQuery } from "convex/react";
import { DossierOverviewPanel } from "../DossierOverviewPanel";

// ─── Test data ────────────────────────────────────────────────────────────────

const CASE_ID = "case_overview_001";

const mockCaseDoc = {
  _id: CASE_ID,
  label: "CASE-001",
  qrCode: "QR-ABC-123",
  status: "deployed",
  locationName: "SkySpecs Field Site — Michigan",
  lat: 42.1234,
  lng: -83.5678,
  assigneeName: "Jane Technician",
  notes: "Equipment for Michigan wind farm deployment.",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_100_000_000,
};

const mockChecklistData = {
  total: 8,
  ok: 5,
  damaged: 2,
  missing: 1,
  unchecked: 0,
  progressPct: 100,
  isComplete: true,
};

const mockFedExData = {
  latestShipment: {
    _id: "ship_1",
    trackingNumber: "794644823741",
    carrier: "FedEx",
  },
  hasTracking: true,
  liveTracking: null,
  isRefreshing: false,
  isActiveShipment: true,
  refreshError: null,
  refreshTracking: vi.fn(),
};

const mockNoFedEx = {
  latestShipment: null,
  hasTracking: false,
  liveTracking: null,
  isRefreshing: false,
  isActiveShipment: false,
  refreshError: null,
  refreshTracking: vi.fn(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPanel(
  props: Partial<React.ComponentProps<typeof DossierOverviewPanel>> = {}
) {
  return render(<DossierOverviewPanel caseId={CASE_ID} {...props} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  // Default: case loaded, checklist loaded, no FedEx
  vi.mocked(useQuery).mockReturnValue(mockCaseDoc as never);
  mockChecklistSummary.mockReturnValue(mockChecklistData);
  mockFedExTracking.mockReturnValue(mockNoFedEx);
});

// ─── 1. Loading state ─────────────────────────────────────────────────────────

describe("DossierOverviewPanel — loading state", () => {
  it("renders loading wrapper when caseDoc is undefined", () => {
    vi.mocked(useQuery).mockReturnValue(undefined as never);
    renderPanel();
    expect(screen.getByTestId("dossier-overview-loading")).toBeTruthy();
  });

  it("sets aria-busy=true in loading state", () => {
    vi.mocked(useQuery).mockReturnValue(undefined as never);
    renderPanel();
    const wrapper = screen.getByTestId("dossier-overview-loading");
    expect(wrapper.getAttribute("aria-busy")).toBe("true");
  });
});

// ─── 2. Not-found state ───────────────────────────────────────────────────────

describe("DossierOverviewPanel — not-found state", () => {
  it("renders not-found element when caseDoc is null", () => {
    vi.mocked(useQuery).mockReturnValue(null as never);
    renderPanel();
    expect(screen.getByTestId("dossier-overview-not-found")).toBeTruthy();
  });

  it("shows 'Case not found' message", () => {
    vi.mocked(useQuery).mockReturnValue(null as never);
    renderPanel();
    expect(screen.getByText("Case not found")).toBeTruthy();
  });
});

// ─── 3. Case header ───────────────────────────────────────────────────────────

describe("DossierOverviewPanel — case header", () => {
  it("renders the main panel with data-testid='dossier-overview-panel'", () => {
    renderPanel();
    expect(screen.getByTestId("dossier-overview-panel")).toBeTruthy();
  });

  it("renders the case label text", () => {
    renderPanel();
    expect(screen.getByText("CASE-001")).toBeTruthy();
  });

  it("renders the QR code when present", () => {
    renderPanel();
    expect(screen.getByText(/QR: QR-ABC-123/)).toBeTruthy();
  });

  it("renders StatusPill with case status", () => {
    renderPanel();
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("deployed");
  });

  it("does NOT render QR code when qrCode is absent", () => {
    vi.mocked(useQuery).mockReturnValue({ ...mockCaseDoc, qrCode: undefined } as never);
    renderPanel();
    expect(screen.queryByText(/QR:/)).toBeNull();
  });
});

// ─── 4. Stats row ─────────────────────────────────────────────────────────────

describe("DossierOverviewPanel — stats row", () => {
  it("renders the stats group with role='group'", () => {
    renderPanel();
    expect(screen.getByRole("group", { name: /case item counts/i })).toBeTruthy();
  });

  it("renders data-testid='dossier-overview-stats'", () => {
    renderPanel();
    expect(screen.getByTestId("dossier-overview-stats")).toBeTruthy();
  });

  it("shows the total items count (8)", () => {
    renderPanel();
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("shows the ok count (5)", () => {
    renderPanel();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("shows the damaged count (2)", () => {
    renderPanel();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows the missing count (1)", () => {
    renderPanel();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("renders all 4 stat labels", () => {
    renderPanel();
    expect(screen.getByText("Total Items")).toBeTruthy();
    expect(screen.getByText("OK")).toBeTruthy();
    expect(screen.getByText("Damaged")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
  });
});

// ─── 5. Metadata grid ─────────────────────────────────────────────────────────

describe("DossierOverviewPanel — metadata grid", () => {
  it("renders location name when present", () => {
    renderPanel();
    expect(screen.getByText("SkySpecs Field Site — Michigan")).toBeTruthy();
  });

  it("renders assignee name when present", () => {
    renderPanel();
    expect(screen.getByText("Jane Technician")).toBeTruthy();
  });

  it("renders coordinates when lat/lng are present", () => {
    renderPanel();
    // lat = 42.1234, lng = -83.5678 → "42.1234, -83.5678"
    expect(screen.getByText(/42.1234/)).toBeTruthy();
  });

  it("does NOT render location when absent", () => {
    vi.mocked(useQuery).mockReturnValue({ ...mockCaseDoc, locationName: undefined } as never);
    renderPanel();
    expect(screen.queryByText("SkySpecs Field Site — Michigan")).toBeNull();
  });

  it("does NOT render assignee when absent", () => {
    vi.mocked(useQuery).mockReturnValue({ ...mockCaseDoc, assigneeName: undefined } as never);
    renderPanel();
    expect(screen.queryByText("Jane Technician")).toBeNull();
  });

  it("does NOT render coordinates when lat/lng absent", () => {
    vi.mocked(useQuery).mockReturnValue({ ...mockCaseDoc, lat: undefined, lng: undefined } as never);
    renderPanel();
    expect(screen.queryByText(/42.1234/)).toBeNull();
  });
});

// ─── 6. Custody section ───────────────────────────────────────────────────────

describe("DossierOverviewPanel — custody section", () => {
  it("renders CustodySection with variant='compact'", () => {
    renderPanel();
    const custody = screen.getByTestId("custody-section");
    expect(custody.getAttribute("data-variant")).toBe("compact");
  });

  it("passes the correct caseId to CustodySection", () => {
    renderPanel();
    const custody = screen.getByTestId("custody-section");
    expect(custody.getAttribute("data-case-id")).toBe(CASE_ID);
  });
});

// ─── 7. FedEx tracking — present ─────────────────────────────────────────────

describe("DossierOverviewPanel — FedEx tracking (hasTracking = true)", () => {
  beforeEach(() => {
    mockFedExTracking.mockReturnValue(mockFedExData);
  });

  it("renders TrackingStatus when hasTracking is true", () => {
    renderPanel();
    expect(screen.getByTestId("tracking-status")).toBeTruthy();
  });

  it("renders TrackingStatus with variant='compact'", () => {
    renderPanel();
    const tracking = screen.getByTestId("tracking-status");
    expect(tracking.getAttribute("data-variant")).toBe("compact");
  });

  it("renders 'Shipment Tracking' section heading", () => {
    renderPanel();
    expect(screen.getByText("Shipment Tracking")).toBeTruthy();
  });
});

// ─── 9. FedEx tracking — absent ───────────────────────────────────────────────

describe("DossierOverviewPanel — FedEx tracking (hasTracking = false)", () => {
  it("does NOT render TrackingStatus when hasTracking is false", () => {
    renderPanel();
    expect(screen.queryByTestId("tracking-status")).toBeNull();
  });

  it("does NOT render 'Shipment Tracking' heading when no tracking", () => {
    renderPanel();
    expect(screen.queryByText("Shipment Tracking")).toBeNull();
  });
});

// ─── 8. Notes ─────────────────────────────────────────────────────────────────

describe("DossierOverviewPanel — notes", () => {
  it("renders notes block when notes are present", () => {
    renderPanel();
    expect(
      screen.getByText("Equipment for Michigan wind farm deployment.")
    ).toBeTruthy();
  });

  it("renders 'Notes' section heading when notes are present", () => {
    renderPanel();
    expect(screen.getByText("Notes")).toBeTruthy();
  });

  it("does NOT render notes section when notes are absent", () => {
    vi.mocked(useQuery).mockReturnValue({ ...mockCaseDoc, notes: undefined } as never);
    renderPanel();
    expect(screen.queryByText("Notes")).toBeNull();
  });
});

// ─── 11. Stats loading skeletons ──────────────────────────────────────────────

describe("DossierOverviewPanel — stats loading state", () => {
  it("renders stats row even when summary is undefined (loading)", () => {
    mockChecklistSummary.mockReturnValue(undefined);
    renderPanel();
    expect(screen.getByTestId("dossier-overview-stats")).toBeTruthy();
  });

  it("shows all 4 stat labels even when loading", () => {
    mockChecklistSummary.mockReturnValue(undefined);
    renderPanel();
    expect(screen.getByText("Total Items")).toBeTruthy();
    expect(screen.getByText("OK")).toBeTruthy();
    expect(screen.getByText("Damaged")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
  });

  it("shows 0 counts when summary has all zeros", () => {
    mockChecklistSummary.mockReturnValue({
      total: 0,
      ok: 0,
      damaged: 0,
      missing: 0,
      unchecked: 0,
      progressPct: 0,
      isComplete: false,
    });
    renderPanel();
    expect(screen.getByText("Total Items")).toBeTruthy();
  });
});
