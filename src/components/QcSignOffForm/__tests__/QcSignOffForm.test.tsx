/**
 * @vitest-environment jsdom
 *
 * QcSignOffForm.test.tsx
 *
 * Unit tests for the QC sign-off form component.
 *
 * The QcSignOffForm renders a multi-line notes textarea and two action buttons
 * ("Reject" / "Approve") that call the `submitQcSignOff` Convex mutation.
 * The Approve button is disabled when `hasUnresolvedIssues` is true; rejection
 * requires non-empty notes.
 *
 * Test strategy
 * ─────────────
 * • `useMutation` (convex/react) is mocked to return a Jest spy.
 * • `useCurrentUser` is mocked with a stable operator identity.
 * • `StatusPill` is mocked as a transparent stub.
 * • CSS modules are mocked as empty objects.
 * • No real Convex environment is needed.
 *
 * Coverage matrix
 * ───────────────
 *
 * Rendering:
 *   ✓ renders the form section
 *   ✓ renders the notes textarea
 *   ✓ renders the Reject button
 *   ✓ renders the Approve button
 *   ✓ renders section title "QC Sign-off"
 *
 * Current status:
 *   ✓ renders approved StatusPill when currentStatus = "approved"
 *   ✓ renders rejected StatusPill when currentStatus = "rejected"
 *   ✓ does not render StatusPill when currentStatus = "pending"
 *   ✓ does not render StatusPill when currentStatus is undefined
 *
 * Unresolved issues warning:
 *   ✓ shows issues banner when hasUnresolvedIssues = true
 *   ✓ hides issues banner when hasUnresolvedIssues = false
 *   ✓ banner displays unresolvedCount in message
 *
 * Disabled state — Approve:
 *   ✓ Approve button is disabled when hasUnresolvedIssues = true
 *   ✓ Approve button is enabled when hasUnresolvedIssues = false
 *   ✓ Approve button has descriptive title when disabled by issues
 *
 * Disabled state — both buttons:
 *   ✓ both buttons are enabled when no submission in flight
 *
 * Validation:
 *   ✓ shows error when Reject clicked with empty notes
 *   ✓ error message is descriptive
 *   ✓ does not call mutation when notes validation fails
 *   ✓ clears error when user types in textarea after a validation error
 *   ✓ allows Approve with empty notes (no validation error)
 *
 * Form interaction:
 *   ✓ textarea value updates on user input
 *   ✓ clicking Approve with valid notes calls submitQcSignOff with status="approved"
 *   ✓ clicking Reject with notes calls submitQcSignOff with status="rejected"
 *   ✓ mutation called with correct caseId
 *   ✓ mutation called with correct notes
 *   ✓ mutation called with signedOffBy from useCurrentUser
 *   ✓ mutation called with signedOffByName from useCurrentUser
 *
 * Success state:
 *   ✓ shows success message after approval
 *   ✓ shows success message after rejection
 *   ✓ clears notes after successful submission
 *   ✓ calls onSuccess callback with correct status
 *
 * Error state:
 *   ✓ shows error message when mutation throws
 */

import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// useMutation — returns the spy as the mutation callable
const mockSubmitQcSignOff = vi.fn().mockResolvedValue({
  qcSignOffId: "qc-id-1",
  eventId:     "evt-id-1",
  status:      "approved",
  caseId:      "case-001",
});

vi.mock("convex/react", () => ({
  useMutation: () => mockSubmitQcSignOff,
}));

// useCurrentUser — stable operator identity
// Path is relative to this test file (3 levels up from __tests__):
//   src/components/QcSignOffForm/__tests__/ → ../../../ → src/ → hooks/use-current-user
vi.mock("../../../hooks/use-current-user", () => ({
  useCurrentUser: () => ({
    id:              "user-operator-001",
    name:            "Alice Operator",
    isLoading:       false,
    isAuthenticated: true,
  }),
}));

// StatusPill — transparent stub
vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind}>{kind}</span>
  ),
}));

// CSS modules — empty objects to avoid processing
vi.mock("../QcSignOffForm.module.css", () => ({ default: {} }));
vi.mock("../../CaseDetail/shared.module.css", () => ({ default: {} }));

// ─── Import SUT after mocks ───────────────────────────────────────────────────
import { QcSignOffForm } from "../QcSignOffForm";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = "case-qc-form-001" as const;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmitQcSignOff.mockResolvedValue({
    qcSignOffId: "qc-id-1",
    eventId:     "evt-id-1",
    status:      "approved",
    caseId:      CASE_ID,
  });
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

describe("QcSignOffForm — rendering", () => {
  it("renders the form section", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    expect(screen.getByTestId("qc-sign-off-form")).toBeTruthy();
  });

  it("renders the notes textarea", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    expect(screen.getByTestId("qc-notes-textarea")).toBeTruthy();
  });

  it("renders the Reject button", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    expect(screen.getByTestId("qc-reject-btn")).toBeTruthy();
  });

  it("renders the Approve button", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    expect(screen.getByTestId("qc-approve-btn")).toBeTruthy();
  });

  it("renders section title 'QC Sign-off'", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    expect(screen.getByText("QC Sign-off")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Current status pill
// ─────────────────────────────────────────────────────────────────────────────

describe("QcSignOffForm — currentStatus pill", () => {
  it("renders a StatusPill when currentStatus = 'approved'", () => {
    render(
      <QcSignOffForm
        caseId={CASE_ID}
        hasUnresolvedIssues={false}
        currentStatus="approved"
      />
    );
    const pill = screen.getByTestId("status-pill");
    expect(pill).toBeTruthy();
    expect(pill.dataset.kind).toBe("completed");
  });

  it("renders a StatusPill with 'flagged' kind when currentStatus = 'rejected'", () => {
    render(
      <QcSignOffForm
        caseId={CASE_ID}
        hasUnresolvedIssues={false}
        currentStatus="rejected"
      />
    );
    const pill = screen.getByTestId("status-pill");
    expect(pill.dataset.kind).toBe("flagged");
  });

  it("does not render StatusPill when currentStatus = 'pending'", () => {
    render(
      <QcSignOffForm
        caseId={CASE_ID}
        hasUnresolvedIssues={false}
        currentStatus="pending"
      />
    );
    expect(screen.queryByTestId("status-pill")).toBeNull();
  });

  it("does not render StatusPill when currentStatus is undefined", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    expect(screen.queryByTestId("status-pill")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unresolved issues warning banner
// ─────────────────────────────────────────────────────────────────────────────

describe("QcSignOffForm — issues banner", () => {
  it("shows issues banner when hasUnresolvedIssues = true", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={true} />);
    expect(screen.getByTestId("qc-issues-banner")).toBeTruthy();
  });

  it("hides issues banner when hasUnresolvedIssues = false", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    expect(screen.queryByTestId("qc-issues-banner")).toBeNull();
  });

  it("banner includes unresolvedCount in accessible label", () => {
    render(
      <QcSignOffForm
        caseId={CASE_ID}
        hasUnresolvedIssues={true}
        unresolvedCount={3}
      />
    );
    const banner = screen.getByTestId("qc-issues-banner");
    const ariaLabel = banner.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Disabled state — Approve button
// ─────────────────────────────────────────────────────────────────────────────

describe("QcSignOffForm — Approve disabled state", () => {
  it("Approve button is disabled when hasUnresolvedIssues = true", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={true} />);
    const approveBtn = screen.getByTestId("qc-approve-btn") as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
  });

  it("Approve button aria-disabled when hasUnresolvedIssues = true", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={true} />);
    const approveBtn = screen.getByTestId("qc-approve-btn");
    expect(approveBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("Approve button is not disabled when hasUnresolvedIssues = false", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    const approveBtn = screen.getByTestId("qc-approve-btn") as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(false);
  });

  it("Approve button has a descriptive title when disabled by issues", () => {
    render(
      <QcSignOffForm
        caseId={CASE_ID}
        hasUnresolvedIssues={true}
        unresolvedCount={2}
      />
    );
    const approveBtn = screen.getByTestId("qc-approve-btn");
    const title = approveBtn.getAttribute("title") ?? "";
    expect(title.toLowerCase()).toContain("cannot approve");
  });

  it("Reject button is not disabled when hasUnresolvedIssues = true", () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={true} />);
    const rejectBtn = screen.getByTestId("qc-reject-btn") as HTMLButtonElement;
    expect(rejectBtn.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation — rejection requires notes
// ─────────────────────────────────────────────────────────────────────────────

describe("QcSignOffForm — validation", () => {
  it("shows error when Reject is clicked with empty notes", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-reject-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-form-error")).toBeTruthy();
    });
  });

  it("error message mentions 'rejection' or 'required'", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-reject-btn"));
    await waitFor(() => {
      const msg = screen.getByTestId("qc-form-error").textContent ?? "";
      expect(msg.toLowerCase()).toMatch(/rejection|required/);
    });
  });

  it("does not call mutation when rejection notes validation fails", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-reject-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-form-error")).toBeTruthy();
    });
    expect(mockSubmitQcSignOff).not.toHaveBeenCalled();
  });

  it("clears error when user types in textarea after validation error", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-reject-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-form-error")).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId("qc-notes-textarea"), {
      target: { value: "Some rejection notes" },
    });
    await waitFor(() => {
      expect(screen.queryByTestId("qc-form-error")).toBeNull();
    });
  });

  it("allows Approve with empty notes — no validation error", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    // Wait a tick — should not show any error
    await waitFor(() => {
      expect(screen.queryByTestId("qc-form-error")).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Form interaction — mutation calls
// ─────────────────────────────────────────────────────────────────────────────

describe("QcSignOffForm — mutation calls", () => {
  it("clicking Approve calls submitQcSignOff with status='approved'", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(mockSubmitQcSignOff).toHaveBeenCalledWith(
        expect.objectContaining({ status: "approved" })
      );
    });
  });

  it("clicking Reject with notes calls submitQcSignOff with status='rejected'", async () => {
    mockSubmitQcSignOff.mockResolvedValueOnce({
      qcSignOffId: "qc-id-2",
      eventId:     "evt-id-2",
      status:      "rejected",
      caseId:      CASE_ID,
    });
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.change(screen.getByTestId("qc-notes-textarea"), {
      target: { value: "Damage on item A — needs rework." },
    });
    fireEvent.click(screen.getByTestId("qc-reject-btn"));
    await waitFor(() => {
      expect(mockSubmitQcSignOff).toHaveBeenCalledWith(
        expect.objectContaining({ status: "rejected" })
      );
    });
  });

  it("mutation is called with the correct caseId", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(mockSubmitQcSignOff).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: CASE_ID })
      );
    });
  });

  it("mutation is called with the notes value from the textarea", async () => {
    const notesText = "All items verified, good to go.";
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.change(screen.getByTestId("qc-notes-textarea"), {
      target: { value: notesText },
    });
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(mockSubmitQcSignOff).toHaveBeenCalledWith(
        expect.objectContaining({ notes: notesText })
      );
    });
  });

  it("mutation is called with signedOffBy from useCurrentUser", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(mockSubmitQcSignOff).toHaveBeenCalledWith(
        expect.objectContaining({ signedOffBy: "user-operator-001" })
      );
    });
  });

  it("mutation is called with signedOffByName from useCurrentUser", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(mockSubmitQcSignOff).toHaveBeenCalledWith(
        expect.objectContaining({ signedOffByName: "Alice Operator" })
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Success state
// ─────────────────────────────────────────────────────────────────────────────

describe("QcSignOffForm — success state", () => {
  it("shows success message after approval", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-form-success")).toBeTruthy();
    });
    const msg = screen.getByTestId("qc-form-success").textContent ?? "";
    expect(msg.toLowerCase()).toContain("approved");
  });

  it("shows success message after rejection", async () => {
    mockSubmitQcSignOff.mockResolvedValueOnce({
      qcSignOffId: "qc-id-3",
      eventId:     "evt-id-3",
      status:      "rejected",
      caseId:      CASE_ID,
    });
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.change(screen.getByTestId("qc-notes-textarea"), {
      target: { value: "Reject notes" },
    });
    fireEvent.click(screen.getByTestId("qc-reject-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-form-success")).toBeTruthy();
    });
    const msg = screen.getByTestId("qc-form-success").textContent ?? "";
    expect(msg.toLowerCase()).toContain("rejected");
  });

  it("clears textarea notes after successful submission", async () => {
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    const textarea = screen.getByTestId("qc-notes-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Pre-approval notes." } });
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
  });

  it("calls onSuccess callback with the confirmed status", async () => {
    const onSuccess = vi.fn();
    render(
      <QcSignOffForm
        caseId={CASE_ID}
        hasUnresolvedIssues={false}
        onSuccess={onSuccess}
      />
    );
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ status: "approved" });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error state — mutation failure
// ─────────────────────────────────────────────────────────────────────────────

describe("QcSignOffForm — mutation error handling", () => {
  it("shows error message when mutation throws", async () => {
    mockSubmitQcSignOff.mockRejectedValueOnce(
      new Error("[CASE_NOT_FOUND] No case found.")
    );
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-form-error")).toBeTruthy();
    });
  });

  it("strips [ERROR_CODE] prefix from error message", async () => {
    mockSubmitQcSignOff.mockRejectedValueOnce(
      new Error("[CASE_NOT_FOUND] No case found with this ID.")
    );
    render(<QcSignOffForm caseId={CASE_ID} hasUnresolvedIssues={false} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      const msg = screen.getByTestId("qc-form-error").textContent ?? "";
      expect(msg).not.toContain("[CASE_NOT_FOUND]");
    });
  });
});
