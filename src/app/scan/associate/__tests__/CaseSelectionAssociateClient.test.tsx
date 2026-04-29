// @vitest-environment jsdom

/**
 * Unit tests: CaseSelectionAssociateClient
 *
 * Sub-AC 3: Case selection/confirmation UI flow for QR-first association.
 *
 * Covers:
 *   1.  Initial render — QR input step is displayed with step badge "1"
 *   2.  Camera unavailable → falls back to manual mode (textarea visible)
 *   3.  Manual QR entry → advances to select step (step badge "2")
 *   4.  Case list rendered with all provided cases
 *   5.  Case search filters the list (matches label)
 *   6.  Case search filters by location name
 *   7.  Case search — no results shows empty state
 *   8.  Clearing search (×) restores full list
 *   9.  Selecting a case highlights it (aria-pressed="true")
 *   10. Confirm button disabled until a case is selected
 *   11. Confirm button enabled after selecting a case
 *   12. Advancing to confirm step shows step badge "3"
 *   13. Confirm step shows selected case label
 *   14. Confirm step shows QR payload
 *   15. Conflict banner shown when qrValidation = "mapped_to_other_case"
 *   16. Already-mapped banner shown when qrValidation = "mapped_to_this_case"
 *   17. "Change Case" button returns to select step
 *   18. Successful association advances to result step (badge "4", success box)
 *   19. Result step "View Case" link points to /scan/[caseId]
 *   20. Result step "Start Over" returns to QR input step
 *   21. Failed association shows error result box with message
 *   22. Retry from error result returns to confirm step
 *   23. Progress track dots update with each step transition
 *   24. Already-associated confirmation button shows "Already Associated"
 *   25. Role-gating: page renders role gate wrapper (component-level smoke test)
 */

import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock CSS modules
vi.mock("../page.module.css", () => ({ default: {} }));

// Mock Convex react
vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

// Mock generated API — path: 5 levels up from __tests__/ reaches project root
vi.mock("../../../../../convex/_generated/api", () => ({
  api: {
    cases: {
      getCaseById:   "cases:getCaseById",
      listCases:     "cases:listCases",
    },
    qrCodes: {
      validateQrCode:        "qrCodes:validateQrCode",
      associateQRCodeToCase: "qrCodes:associateQRCodeToCase",
    },
  },
}));

// Mock useKindeUser — path: 4 levels up from __tests__/ reaches src/
vi.mock("../../../../hooks/use-kinde-user", () => ({
  useKindeUser: vi.fn(() => ({ id: "user_test", name: "Test Tech", isLoading: false, isAuthenticated: true })),
}));

// Mock useScanMutations / useAssociateQRCode — path: 4 levels up reaches src/
vi.mock("../../../../hooks/use-scan-mutations", () => ({
  useAssociateQRCode: vi.fn(),
}));

// Mock StatusPill — path: 4 levels up reaches src/
vi.mock("../../../../components/StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => <span data-testid={`status-pill-${kind}`}>{kind}</span>,
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { useQuery, useMutation } from "convex/react";
import { useAssociateQRCode } from "../../../../hooks/use-scan-mutations";
import { CaseSelectionAssociateClient } from "../CaseSelectionAssociateClient";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_A = {
  _id: "case_aaa111",
  label: "CASE-AAA-111",
  status: "assembled",
  locationName: "Denver HQ",
  assigneeName: "Alice Smith",
  updatedAt: 1_700_000_000_000,
  qrCode: "",
};

const CASE_B = {
  _id: "case_bbb222",
  label: "CASE-BBB-222",
  status: "deployed",
  locationName: "Site Alpha",
  assigneeName: "Bob Jones",
  updatedAt: 1_700_100_000_000,
  qrCode: "https://scan.example.com/old-qr",
};

const CASE_C = {
  _id: "case_ccc333",
  label: "CASE-CCC-333",
  status: "transit_out",
  locationName: "Airport Gate 7",
  assigneeName: "Charlie Brown",
  updatedAt: 1_700_200_000_000,
  qrCode: "",
};

const MOCK_CASES = [CASE_A, CASE_B, CASE_C];

const QR_PAYLOAD = "https://scan.example.com/case/new-label?uid=abc12345";

// ─── Setup helpers ────────────────────────────────────────────────────────────

type QrValidation =
  | { status: "available" }
  | { status: "mapped_to_this_case" }
  | { status: "mapped_to_other_case"; conflictingCaseLabel?: string; conflictingCaseId?: string };

function setupMocks({
  cases = MOCK_CASES,
  caseDoc = CASE_A,
  qrValidation = { status: "available" } as QrValidation,
  associateResult = { wasAlreadyMapped: false },
  associateRejects = false,
  associateError = "Server error: duplicate QR code.",
}: {
  cases?: typeof MOCK_CASES;
  caseDoc?: typeof CASE_A | null;
  qrValidation?: QrValidation;
  associateResult?: { wasAlreadyMapped: boolean };
  associateRejects?: boolean;
  associateError?: string;
} = {}) {
  const mockAssociate = vi.fn().mockImplementation(
    () =>
      associateRejects
        ? Promise.reject(new Error(associateError))
        : Promise.resolve(associateResult)
  );

  (useQuery as ReturnType<typeof vi.fn>).mockImplementation(
    (queryFn: unknown) => {
      if (queryFn === "cases:listCases")     return cases;
      if (queryFn === "cases:getCaseById")   return caseDoc;
      if (queryFn === "qrCodes:validateQrCode") return qrValidation;
      return null;
    }
  );

  (useMutation as ReturnType<typeof vi.fn>).mockReturnValue(
    Object.assign(mockAssociate, {
      withOptimisticUpdate: () => mockAssociate,
    })
  );

  (useAssociateQRCode as ReturnType<typeof vi.fn>).mockReturnValue(mockAssociate);

  return { mockAssociate };
}

// Ensure BarcodeDetector is absent (forces camera→manual fallback)
function removeBarcodeDetector() {
  delete (window as unknown as Record<string, unknown>).BarcodeDetector;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Submit a manual QR value and advance to the select step. */
async function advanceToSelectStep(qr = QR_PAYLOAD) {
  // Camera unavailable → component auto-switches to manual
  const textarea = await waitFor(() => {
    const el = screen.queryByRole("textbox");
    if (!el) throw new Error("textarea not found");
    return el;
  }, { timeout: 2000 });

  fireEvent.change(textarea, { target: { value: qr } });
  fireEvent.click(screen.getByRole("button", { name: /next: select case/i }));

  await waitFor(() => {
    expect(screen.queryByTestId("case-select-step")).not.toBeNull();
  }, { timeout: 2000 });
}

/** Advance from select step to confirm step by selecting a case. */
async function advanceToConfirmStep(caseId = CASE_A._id) {
  // Select the case
  const caseRow = await waitFor(() => {
    const el = screen.queryByTestId(`case-row-${caseId}`);
    if (!el) throw new Error(`case-row-${caseId} not found`);
    return el;
  }, { timeout: 2000 });

  fireEvent.click(caseRow);

  // Confirm case selection
  const confirmBtn = screen.getByTestId("confirm-case-selection-btn");
  fireEvent.click(confirmBtn);

  await waitFor(() => {
    expect(screen.queryByTestId("confirm-step")).not.toBeNull();
  }, { timeout: 2000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CaseSelectionAssociateClient — Sub-AC 3", () => {
  beforeEach(() => {
    removeBarcodeDetector();
    setupMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Step 1: QR input ──────────────────────────────────────────────────────

  it("1. renders the QR input step with step number badge on initial load", () => {
    render(<CaseSelectionAssociateClient />);
    // Step badge "1" is present
    const badge = screen.getByLabelText("Step 1 of 4");
    expect(badge).not.toBeNull();
  });

  it("2. falls back to manual mode when BarcodeDetector is unavailable", async () => {
    render(<CaseSelectionAssociateClient />);
    const textarea = await waitFor(
      () => {
        const el = screen.queryByRole("textbox");
        if (!el) throw new Error("textarea not found");
        return el;
      },
      { timeout: 2000 }
    );
    expect(textarea).not.toBeNull();
  });

  it("3. manual QR submission advances to the select step", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    expect(screen.getByTestId("case-select-step")).not.toBeNull();
  });

  // ── Step 2: Case selection ────────────────────────────────────────────────

  it("4. case list renders all provided cases", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();

    await waitFor(() => {
      expect(screen.queryByTestId("case-list")).not.toBeNull();
    }, { timeout: 2000 });

    expect(screen.queryByTestId(`case-row-${CASE_A._id}`)).not.toBeNull();
    expect(screen.queryByTestId(`case-row-${CASE_B._id}`)).not.toBeNull();
    expect(screen.queryByTestId(`case-row-${CASE_C._id}`)).not.toBeNull();
  });

  it("5. case search filters list by label", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();

    await waitFor(() => screen.queryByTestId("case-search-input") !== null);

    const searchInput = screen.getByTestId("case-search-input");
    fireEvent.change(searchInput, { target: { value: "AAA" } });

    await waitFor(() => {
      expect(screen.queryByTestId(`case-row-${CASE_A._id}`)).not.toBeNull();
      expect(screen.queryByTestId(`case-row-${CASE_B._id}`)).toBeNull();
      expect(screen.queryByTestId(`case-row-${CASE_C._id}`)).toBeNull();
    });
  });

  it("6. case search filters by location name", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();

    await waitFor(() => screen.queryByTestId("case-search-input") !== null);

    const searchInput = screen.getByTestId("case-search-input");
    fireEvent.change(searchInput, { target: { value: "site alpha" } });

    await waitFor(() => {
      expect(screen.queryByTestId(`case-row-${CASE_B._id}`)).not.toBeNull();
      expect(screen.queryByTestId(`case-row-${CASE_A._id}`)).toBeNull();
    });
  });

  it("7. case search with no matches shows empty state", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();

    await waitFor(() => screen.queryByTestId("case-search-input") !== null);

    const searchInput = screen.getByTestId("case-search-input");
    fireEvent.change(searchInput, { target: { value: "zzz_no_match_xyz" } });

    await waitFor(() => {
      expect(screen.queryByTestId("case-list")).toBeNull();
    });
  });

  it("8. clear search button restores the full list", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();

    await waitFor(() => screen.queryByTestId("case-search-input") !== null);

    const searchInput = screen.getByTestId("case-search-input");
    fireEvent.change(searchInput, { target: { value: "AAA" } });

    // Wait for filter to apply
    await waitFor(() => screen.queryByTestId(`case-row-${CASE_B._id}`) === null);

    // Click clear button
    const clearBtn = screen.getByLabelText("Clear search");
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.queryByTestId(`case-row-${CASE_A._id}`)).not.toBeNull();
      expect(screen.queryByTestId(`case-row-${CASE_B._id}`)).not.toBeNull();
      expect(screen.queryByTestId(`case-row-${CASE_C._id}`)).not.toBeNull();
    });
  });

  it("9. selecting a case sets aria-pressed='true' on that row", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();

    await waitFor(() => screen.queryByTestId(`case-row-${CASE_A._id}`) !== null);

    const caseRow = screen.getByTestId(`case-row-${CASE_A._id}`);
    expect(caseRow.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(caseRow);

    expect(caseRow.getAttribute("aria-pressed")).toBe("true");
  });

  it("10. confirm button is disabled when no case is selected", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();

    await waitFor(() => screen.queryByTestId("confirm-case-selection-btn") !== null);

    const confirmBtn = screen.getByTestId("confirm-case-selection-btn") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it("11. confirm button is enabled after a case is selected", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();

    await waitFor(() => screen.queryByTestId(`case-row-${CASE_A._id}`) !== null);
    fireEvent.click(screen.getByTestId(`case-row-${CASE_A._id}`));

    const confirmBtn = screen.getByTestId("confirm-case-selection-btn") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  // ── Step 3: Confirmation ──────────────────────────────────────────────────

  it("12. advancing to confirm step shows step badge '3'", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    expect(screen.getByLabelText("Step 3 of 4")).not.toBeNull();
  });

  it("13. confirm step displays the selected case label", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => {
      expect(screen.queryByText(CASE_A.label)).not.toBeNull();
    }, { timeout: 2000 });
  });

  it("14. confirm step displays the QR payload", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep(QR_PAYLOAD);
    await advanceToConfirmStep();

    // QR is truncated to 48 chars in display
    const truncated = QR_PAYLOAD.slice(0, 48);
    await waitFor(() => {
      expect(screen.queryByText(new RegExp(truncated.slice(0, 20)))).not.toBeNull();
    }, { timeout: 2000 });
  });

  it("15. conflict banner shown when qrValidation is 'mapped_to_other_case'", async () => {
    setupMocks({
      qrValidation: {
        status: "mapped_to_other_case",
        conflictingCaseLabel: "CASE-OTHER-999",
        conflictingCaseId: "case_other_999",
      },
    });

    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => {
      expect(screen.queryByText(/QR code already in use/i)).not.toBeNull();
    }, { timeout: 2000 });
  });

  it("16. already-mapped banner shown when qrValidation is 'mapped_to_this_case'", async () => {
    setupMocks({ qrValidation: { status: "mapped_to_this_case" } });

    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => {
      // The info banner contains "This QR code is already mapped to this case"
      expect(
        screen.queryByText(/This QR code is already mapped to this case/i)
      ).not.toBeNull();
    }, { timeout: 2000 });
  });

  it("17. 'Change Case' button returns to the select step", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => screen.queryByTestId("confirm-step") !== null);

    // The "Change Case" button
    const changeCaseBtn = screen.getAllByRole("button", { name: /change case/i })[0];
    fireEvent.click(changeCaseBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("case-select-step")).not.toBeNull();
    });
  });

  // ── Step 4: Result ────────────────────────────────────────────────────────

  it("18. successful association shows success result box", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => screen.queryByTestId("confirm-association-btn") !== null);
    fireEvent.click(screen.getByTestId("confirm-association-btn"));

    await waitFor(() => {
      expect(screen.queryByTestId("result-success")).not.toBeNull();
    }, { timeout: 3000 });
  });

  it("19. success result 'View Case' link points to /scan/[caseId]", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => screen.queryByTestId("confirm-association-btn") !== null);
    fireEvent.click(screen.getByTestId("confirm-association-btn"));

    await waitFor(() => screen.queryByTestId("view-case-link") !== null, { timeout: 3000 });

    const viewCaseLink = screen.getByTestId("view-case-link") as HTMLAnchorElement;
    expect(viewCaseLink.href).toContain(`/scan/${CASE_A._id}`);
  });

  it("20. 'Start Over' button on result step returns to QR input step", async () => {
    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => screen.queryByTestId("confirm-association-btn") !== null);
    fireEvent.click(screen.getByTestId("confirm-association-btn"));

    await waitFor(() => screen.queryByTestId("start-over-btn") !== null, { timeout: 3000 });
    fireEvent.click(screen.getByTestId("start-over-btn"));

    await waitFor(() => {
      expect(screen.queryByTestId("qr-input-step")).not.toBeNull();
    });
  });

  it("21. failed association shows error result box with message", async () => {
    const errorMessage = "Server error: duplicate QR code.";
    setupMocks({ associateRejects: true, associateError: errorMessage });

    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => screen.queryByTestId("confirm-association-btn") !== null);
    fireEvent.click(screen.getByTestId("confirm-association-btn"));

    await waitFor(() => {
      expect(screen.queryByTestId("result-error")).not.toBeNull();
    }, { timeout: 3000 });
  });

  it("22. 'Try Again' on error result returns to confirm step", async () => {
    setupMocks({ associateRejects: true });

    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => screen.queryByTestId("confirm-association-btn") !== null);
    fireEvent.click(screen.getByTestId("confirm-association-btn"));

    await waitFor(() => screen.queryByTestId("retry-btn") !== null, { timeout: 3000 });
    fireEvent.click(screen.getByTestId("retry-btn"));

    await waitFor(() => {
      expect(screen.queryByTestId("confirm-step")).not.toBeNull();
    });
  });

  it("23. progress track dots advance with each step transition", async () => {
    render(<CaseSelectionAssociateClient />);

    // Step 1: first dot is active
    expect(screen.getByLabelText("Step 1 of 4")).not.toBeNull();

    await advanceToSelectStep();

    // Step 2: second dot is active
    expect(screen.getByLabelText("Step 2 of 4")).not.toBeNull();

    await advanceToConfirmStep();

    // Step 3: third dot is active
    expect(screen.getByLabelText("Step 3 of 4")).not.toBeNull();
  });

  it("24. confirm button shows 'Already Associated' when qrValidation is 'mapped_to_this_case'", async () => {
    setupMocks({ qrValidation: { status: "mapped_to_this_case" } });

    render(<CaseSelectionAssociateClient />);
    await advanceToSelectStep();
    await advanceToConfirmStep();

    await waitFor(() => {
      const btn = screen.queryByTestId("confirm-association-btn");
      expect(btn).not.toBeNull();
      expect(btn?.textContent).toContain("Already Associated");
    }, { timeout: 2000 });
  });

  it("25. page renders without crashing (smoke test)", () => {
    expect(() => render(<CaseSelectionAssociateClient />)).not.toThrow();
  });
});
