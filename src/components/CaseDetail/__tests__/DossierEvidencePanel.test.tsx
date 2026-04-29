/**
 * @vitest-environment jsdom
 *
 * Unit tests: DossierEvidencePanel — Evidence tab content for T4DossierShell.
 *
 * Covers:
 *   1.  Loading state — renders skeleton when any subscription is undefined
 *   2.  Empty state — renders empty state when no damage photos or reports
 *   3.  Inspection header — renders inspector name, dates, status pill, progress
 *   4.  No inspection — shows guidance text when inspection is null
 *   5.  Damage summary strip — correct counts in stat cells
 *   6.  Progress bar — correct width and aria attributes
 *   7.  Photo gallery — renders photo cards for all photos
 *   8.  Photo card — severity badge, annotation pins, reporter, timestamp
 *   9.  Photo with resolved URL — renders img element with src
 *   10. Photo with null URL — renders placeholder element
 *   11. Annotation toggle — expand/collapse annotation list per photo
 *   12. Annotation list — label, index, coord rendered for each pin
 *   13. Item-level damage cards — one card per damaged manifest item
 *   14. Damage card — item name, status pill, severity badge, reporter, notes
 *   15. Case-level photos section — shown when photos have no templateItemId
 *   16. Severity badge styles — minor/moderate/severe variants applied
 *   17. Real-time subscription parameters — hooks called with correct caseId
 *   18. ARIA roles — list, listitem, progressbar, button attributes
 *   19. data-testid attributes — key elements have test IDs for E2E
 *   20. IBM Plex Mono timestamps — time elements rendered for reportedAt
 */

import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock hooks ───────────────────────────────────────────────────────────────

const mockUseDamagePhotoReportsWithUrls = vi.fn();
const mockUseDamageReportsByCase = vi.fn();
const mockUseChecklistWithInspection = vi.fn();

vi.mock("../../../hooks/use-damage-reports", () => ({
  useDamagePhotoReportsWithUrls: (...args: unknown[]) =>
    mockUseDamagePhotoReportsWithUrls(...args),
  useDamageReportsByCase: (...args: unknown[]) =>
    mockUseDamageReportsByCase(...args),
}));

vi.mock("../../../hooks/use-checklist", () => ({
  useChecklistWithInspection: (...args: unknown[]) =>
    mockUseChecklistWithInspection(...args),
}));

// ─── Mock StatusPill ──────────────────────────────────────────────────────────

vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind} />
  ),
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

import { DossierEvidencePanel } from "../DossierEvidencePanel";

// ─── Type aliases for test fixtures ──────────────────────────────────────────

type PhotoWithUrl = {
  id: string;
  caseId: string;
  photoStorageId: string;
  photoUrl: string | null;
  annotations: Array<{ x: number; y: number; label: string; color?: string }>;
  severity: "minor" | "moderate" | "severe";
  reportedAt: number;
  manifestItemId?: string;
  templateItemId?: string;
  reportedById: string;
  reportedByName: string;
  notes?: string;
};

type DamageReport = {
  manifestItemId: string;
  caseId: string;
  caseLabel: string;
  templateItemId: string;
  itemName: string;
  photoStorageIds: string[];
  notes?: string;
  reportedAt?: number;
  reportedById?: string;
  reportedByName?: string;
  severity?: string;
};

type ChecklistData = {
  items: Array<{
    _id: string;
    templateItemId: string;
    name: string;
    status: "unchecked" | "ok" | "damaged" | "missing";
    notes?: string;
  }>;
  inspection: {
    _id: string;
    _creationTime: number;
    status: string;
    inspectorId: string;
    inspectorName: string;
    startedAt?: number;
    completedAt?: number;
    totalItems: number;
    checkedItems: number;
    damagedItems: number;
    missingItems: number;
    notes?: string;
  } | null;
  summary: {
    caseId: string;
    total: number;
    ok: number;
    damaged: number;
    missing: number;
    unchecked: number;
    progressPct: number;
    isComplete: boolean;
  };
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = "case_evidence_001";

function makePhoto(overrides: Partial<PhotoWithUrl> = {}): PhotoWithUrl {
  return {
    id: "photo_001",
    caseId: CASE_ID,
    photoStorageId: "storage_abc",
    photoUrl: "https://example.com/damage-photo.jpg",
    annotations: [],
    severity: "moderate",
    reportedAt: 1_700_000_000_000,
    reportedById: "user_tech_01",
    reportedByName: "Jane Tech",
    ...overrides,
  };
}

function makeReport(overrides: Partial<DamageReport> = {}): DamageReport {
  return {
    manifestItemId: "item_001",
    caseId: CASE_ID,
    caseLabel: "CASE-001",
    templateItemId: "tpl_001",
    itemName: "Drone Body",
    photoStorageIds: [],
    reportedAt: 1_700_000_000_000,
    reportedById: "user_tech_01",
    reportedByName: "Jane Tech",
    severity: "moderate",
    ...overrides,
  };
}

function makeChecklistData(overrides: Partial<ChecklistData> = {}): ChecklistData {
  const base: ChecklistData = {
    items: [
      { _id: "mi_001", templateItemId: "tpl_001", name: "Drone Body", status: "damaged" },
      { _id: "mi_002", templateItemId: "tpl_002", name: "Remote Control", status: "ok" },
      { _id: "mi_003", templateItemId: "tpl_003", name: "Battery Pack", status: "unchecked" },
    ],
    inspection: {
      _id: "insp_001",
      _creationTime: 1_700_000_000_000,
      status: "in_progress",
      inspectorId: "user_tech_01",
      inspectorName: "Jane Tech",
      startedAt: 1_700_000_000_000,
      totalItems: 3,
      checkedItems: 1,
      damagedItems: 1,
      missingItems: 0,
    },
    summary: {
      caseId: CASE_ID,
      total: 3,
      ok: 1,
      damaged: 1,
      missing: 0,
      unchecked: 1,
      progressPct: 33,
      isComplete: false,
    },
  };

  return { ...base, ...overrides };
}

function renderPanel(caseId = CASE_ID) {
  return render(<DossierEvidencePanel caseId={caseId} />);
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Default: all hooks return undefined (loading state)
  mockUseDamagePhotoReportsWithUrls.mockReturnValue(undefined);
  mockUseDamageReportsByCase.mockReturnValue(undefined);
  mockUseChecklistWithInspection.mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DossierEvidencePanel", () => {
  // ── 1. Loading state ──────────────────────────────────────────────────────

  it("renders loading skeleton when photos are undefined", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(undefined);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData());
    renderPanel();

    // The panel should render in loading state (skeleton aria-label)
    expect(screen.getByLabelText("Loading evidence data")).toBeTruthy();
  });

  it("renders loading skeleton when damage reports are undefined", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue(undefined);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData());
    renderPanel();

    expect(screen.getByLabelText("Loading evidence data")).toBeTruthy();
  });

  it("renders loading skeleton when checklist data is undefined", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(undefined);
    renderPanel();

    expect(screen.getByLabelText("Loading evidence data")).toBeTruthy();
  });

  it("has data-testid for loading state", () => {
    renderPanel();

    expect(
      document.querySelector('[data-testid="evidence-panel-loading"]')
    ).toBeTruthy();
  });

  // ── 2. Empty state ────────────────────────────────────────────────────────

  it("renders empty state when no photos and no damage reports", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByTestId("evidence-empty-state")).toBeTruthy();
    expect(screen.getByText("No damage evidence recorded")).toBeTruthy();
  });

  it("does not render empty state when there are photos", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([makePhoto()]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.queryByTestId("evidence-empty-state")).toBeFalsy();
  });

  // ── 3. Inspection header ──────────────────────────────────────────────────

  it("renders inspection header section when checklistData is present", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData());
    renderPanel();

    expect(screen.getByTestId("evidence-inspection-header")).toBeTruthy();
    expect(screen.getByText("Inspection Report")).toBeTruthy();
  });

  it("renders inspector name in the inspection header", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData());
    renderPanel();

    expect(screen.getByText("Jane Tech")).toBeTruthy();
  });

  it("renders inspection status pill with correct kind", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData());
    renderPanel();

    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-kind")).toBe("in_progress");
  });

  it("renders inspection notes when present", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData({
        inspection: {
          _id: "insp_001",
          _creationTime: 1_700_000_000_000,
          status: "completed",
          inspectorId: "user_tech_01",
          inspectorName: "Jane Tech",
          totalItems: 3,
          checkedItems: 3,
          damagedItems: 1,
          missingItems: 0,
          notes: "Found surface cracks on drone body.",
        },
      })
    );
    renderPanel();

    expect(screen.getByText("Found surface cracks on drone body.")).toBeTruthy();
  });

  // ── 4. No inspection ──────────────────────────────────────────────────────

  it("renders no-inspection guidance when inspection is null", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    // Text contains "No inspection has been started"
    const el = screen.getByText(/No inspection has been started/);
    expect(el).toBeTruthy();
  });

  // ── 5. Damage summary strip ───────────────────────────────────────────────

  it("renders summary stat labels", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData());
    renderPanel();

    expect(screen.getByText("Total Items")).toBeTruthy();
    expect(screen.getByText("OK")).toBeTruthy();
    expect(screen.getByText("Damaged")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
  });

  it("renders total items count in summary strip", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData({
        summary: {
          caseId: CASE_ID,
          total: 8,
          ok: 5,
          damaged: 2,
          missing: 1,
          unchecked: 0,
          progressPct: 100,
          isComplete: true,
        },
      })
    );
    renderPanel();

    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  // ── 6. Progress bar ───────────────────────────────────────────────────────

  it("renders progress bar with correct aria-valuenow", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData());
    renderPanel();

    const progressBar = screen.getByRole("progressbar");
    expect(progressBar.getAttribute("aria-valuenow")).toBe("33");
    expect(progressBar.getAttribute("aria-valuemin")).toBe("0");
    expect(progressBar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("renders progress meta text", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData());
    renderPanel();

    expect(screen.getByText("33% complete")).toBeTruthy();
    // ok=1 + damaged=1 + missing=0 = 2 reviewed out of 3 total
    expect(screen.getByText("2 / 3 reviewed")).toBeTruthy();
  });

  // ── 7. Photo gallery ──────────────────────────────────────────────────────

  it("renders photo gallery section heading when photos exist", () => {
    const photos = [makePhoto({ id: "p1" }), makePhoto({ id: "p2" })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Photo Evidence")).toBeTruthy();
    expect(screen.getByText("2 photos")).toBeTruthy();
  });

  it("renders one photo card per photo", () => {
    const photos = [
      makePhoto({ id: "p1" }),
      makePhoto({ id: "p2", severity: "severe" }),
      makePhoto({ id: "p3", severity: "minor" }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const cards = screen.getAllByTestId("evidence-photo-card");
    expect(cards.length).toBe(3);
  });

  // ── 8. Photo card anatomy ────────────────────────────────────────────────

  it("renders severity badge in photo card", () => {
    const photos = [makePhoto({ severity: "severe" })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Severe")).toBeTruthy();
  });

  it("renders reporter name in photo card", () => {
    const photos = [makePhoto({ reportedByName: "Bob Pilot" })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Bob Pilot")).toBeTruthy();
  });

  it("renders photo notes when present", () => {
    const photos = [makePhoto({ notes: "Crack on port side." })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Crack on port side.")).toBeTruthy();
  });

  it("photo card aria-label references severity", () => {
    const photos = [makePhoto({ severity: "severe" })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const card = screen.getByTestId("evidence-photo-card");
    expect(card.getAttribute("aria-label")).toContain("severe");
  });

  // ── 9. Photo with resolved URL ────────────────────────────────────────────

  it("renders img element when photoUrl is a string", () => {
    const photos = [makePhoto({ photoUrl: "https://example.com/photo.jpg" })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const img = document.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("https://example.com/photo.jpg");
  });

  // ── 10. Photo with null URL ───────────────────────────────────────────────

  it("renders placeholder img role when photoUrl is null", () => {
    const photos = [makePhoto({ photoUrl: null })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const placeholder = screen.getByRole("img", { name: "Photo unavailable" });
    expect(placeholder).toBeTruthy();
    // No real img element
    expect(document.querySelector("img")).toBeFalsy();
  });

  // ── 11. Annotation toggle expand/collapse ────────────────────────────────

  it("renders annotation toggle button when photo has annotations", () => {
    const photos = [
      makePhoto({
        annotations: [
          { x: 0.4, y: 0.5, label: "crack" },
          { x: 0.7, y: 0.3, label: "dent" },
        ],
      }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("2 annotation");
  });

  it("expands annotation list on toggle button click", () => {
    const photos = [
      makePhoto({
        id: "p_toggle",
        annotations: [{ x: 0.4, y: 0.5, label: "crack" }],
      }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const toggleBtn = screen.getByRole("button");
    expect(screen.queryByText("crack")).toBeFalsy(); // collapsed

    fireEvent.click(toggleBtn);

    expect(screen.getByText("crack")).toBeTruthy(); // expanded
  });

  it("collapses annotation list on second toggle click", () => {
    const photos = [
      makePhoto({
        id: "p_toggle2",
        annotations: [{ x: 0.4, y: 0.5, label: "burn" }],
      }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const toggleBtn = screen.getByRole("button");
    fireEvent.click(toggleBtn);
    expect(screen.getByText("burn")).toBeTruthy();

    // Click again to collapse
    fireEvent.click(toggleBtn);
    expect(screen.queryByText("burn")).toBeFalsy();
  });

  // ── 12. Annotation list detail ────────────────────────────────────────────

  it("renders annotation label and coordinates in the expanded list", () => {
    const photos = [
      makePhoto({
        id: "p_ann",
        annotations: [{ x: 0.4, y: 0.6, label: "impact point" }],
      }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("impact point")).toBeTruthy();
    expect(screen.getByText("40%, 60%")).toBeTruthy();
  });

  it("renders annotation index markers (#1, #2)", () => {
    const photos = [
      makePhoto({
        id: "p_idx",
        annotations: [
          { x: 0.1, y: 0.2, label: "A" },
          { x: 0.5, y: 0.5, label: "B" },
        ],
      }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
  });

  // ── 13. Item-level damage cards ───────────────────────────────────────────

  it("renders damage item section heading when damage reports exist", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([makeReport()]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Damaged Items")).toBeTruthy();
    expect(screen.getByText("1 item")).toBeTruthy();
  });

  it("renders one card per damage report", () => {
    const reports = [
      makeReport({ manifestItemId: "item_001", templateItemId: "tpl_001", itemName: "Drone Body" }),
      makeReport({ manifestItemId: "item_002", templateItemId: "tpl_002", itemName: "Battery Pack" }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue(reports);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const cards = screen.getAllByTestId("evidence-damage-item-card");
    expect(cards.length).toBe(2);
  });

  // ── 14. Damage card anatomy ───────────────────────────────────────────────

  it("renders item name in damage card", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([makeReport({ itemName: "LiPo Battery" })]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("LiPo Battery")).toBeTruthy();
  });

  it("renders severity badge in damage card", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([makeReport({ severity: "severe" })]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Severe")).toBeTruthy();
  });

  it("renders damage report notes in the card", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([
      makeReport({ notes: "Visible crack on exterior shell." }),
    ]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Visible crack on exterior shell.")).toBeTruthy();
  });

  it("renders reporter name in damage card", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([
      makeReport({ reportedByName: "Carlos Pilot" }),
    ]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Carlos Pilot")).toBeTruthy();
  });

  it("damage card aria-label references item name", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([makeReport({ itemName: "Propeller Guard" })]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const card = screen.getByTestId("evidence-damage-item-card");
    expect(card.getAttribute("aria-label")).toContain("Propeller Guard");
  });

  // ── 15. Case-level photos section ────────────────────────────────────────

  it("renders case-level photos section when photos have no templateItemId", () => {
    const casePhoto = makePhoto({ id: "cl_001", templateItemId: undefined });
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([casePhoto]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Case-Level Photos")).toBeTruthy();
    expect(screen.getByText("Not linked to a specific item")).toBeTruthy();
  });

  it("does not render case-level photos section when all photos are item-linked", () => {
    const itemPhoto = makePhoto({ id: "ip_001", templateItemId: "tpl_001" });
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([itemPhoto]);
    mockUseDamageReportsByCase.mockReturnValue([makeReport()]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.queryByText("Case-Level Photos")).toBeFalsy();
  });

  // ── 16. Severity badge text variants ─────────────────────────────────────

  it("renders Minor severity badge text", () => {
    const photos = [makePhoto({ severity: "minor" })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Minor")).toBeTruthy();
  });

  it("renders Moderate severity badge text", () => {
    const photos = [makePhoto({ severity: "moderate" })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("Moderate")).toBeTruthy();
  });

  // ── 17. Hook call parameters ──────────────────────────────────────────────

  it("calls useDamagePhotoReportsWithUrls with the correct caseId", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel("case_specific_id");

    expect(mockUseDamagePhotoReportsWithUrls).toHaveBeenCalledWith("case_specific_id");
  });

  it("calls useDamageReportsByCase with the correct caseId", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel("case_specific_id");

    expect(mockUseDamageReportsByCase).toHaveBeenCalledWith("case_specific_id");
  });

  it("calls useChecklistWithInspection with the correct caseId", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel("case_specific_id");

    expect(mockUseChecklistWithInspection).toHaveBeenCalledWith("case_specific_id");
  });

  // ── 18. ARIA roles ────────────────────────────────────────────────────────

  it("renders photo gallery as a list element", () => {
    const photos = [makePhoto({ id: "p1" }), makePhoto({ id: "p2" })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const gallery = screen.getByRole("list", { name: "2 damage photos" });
    expect(gallery).toBeTruthy();
  });

  it("renders damage item list with aria-label", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([makeReport()]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const list = screen.getByRole("list", { name: "Damaged manifest items" });
    expect(list).toBeTruthy();
  });

  it("renders annotation toggle button with aria-expanded=false when collapsed", () => {
    const photos = [
      makePhoto({ annotations: [{ x: 0.5, y: 0.5, label: "test" }] }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("sets aria-expanded=true after expanding annotation list", () => {
    const photos = [
      makePhoto({ annotations: [{ x: 0.5, y: 0.5, label: "test" }] }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  // ── 19. data-testid attributes ────────────────────────────────────────────

  it("renders evidence-panel testid on loaded root", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByTestId("evidence-panel")).toBeTruthy();
  });

  it("renders evidence-photo-card testid for each photo", () => {
    const photos = [makePhoto({ id: "t1" }), makePhoto({ id: "t2" })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getAllByTestId("evidence-photo-card").length).toBe(2);
  });

  it("renders evidence-damage-item-card testid for each damage report", () => {
    const reports = [
      makeReport({ manifestItemId: "a", templateItemId: "ta" }),
      makeReport({ manifestItemId: "b", templateItemId: "tb" }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue(reports);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getAllByTestId("evidence-damage-item-card").length).toBe(2);
  });

  // ── 20. Timestamp rendering ───────────────────────────────────────────────

  it("renders a <time> element with datetime attribute for each photo", () => {
    const reportedAt = 1_700_000_000_000;
    const photos = [makePhoto({ reportedAt })];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    const timeEl = document.querySelector("time");
    expect(timeEl).toBeTruthy();
    // datetime attribute should be an ISO string
    const dt = timeEl?.getAttribute("datetime") ?? "";
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ── Bonus: annotation count badge ─────────────────────────────────────────

  it("renders annotation count badge label when photo has annotations", () => {
    const photos = [
      makePhoto({
        annotations: [{ x: 0.3, y: 0.7, label: "pin A" }],
      }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue(photos);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    // Annotation count badge visible (aria-label="1 annotation")
    const countBadge = screen.getByLabelText("1 annotation");
    expect(countBadge).toBeTruthy();
  });

  // ── Bonus: render damage item count label ─────────────────────────────────

  it("renders plural 'items' label for multiple damage reports", () => {
    const reports = [
      makeReport({ manifestItemId: "a", templateItemId: "ta" }),
      makeReport({ manifestItemId: "b", templateItemId: "tb" }),
    ];
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([]);
    mockUseDamageReportsByCase.mockReturnValue(reports);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("2 items")).toBeTruthy();
  });

  // ── Bonus: render singular 'photo' label ──────────────────────────────────

  it("renders singular '1 photo' label when exactly one photo exists", () => {
    mockUseDamagePhotoReportsWithUrls.mockReturnValue([makePhoto()]);
    mockUseDamageReportsByCase.mockReturnValue([]);
    mockUseChecklistWithInspection.mockReturnValue(makeChecklistData({ inspection: null }));
    renderPanel();

    expect(screen.getByText("1 photo")).toBeTruthy();
  });
});
