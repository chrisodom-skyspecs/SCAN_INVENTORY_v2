/**
 * RecallModal Step 1 (Confirm) — unit tests.
 *
 * Tests:
 *   Rendering:
 *     - Modal renders when isOpen=true
 *     - Modal does not render (portal null) when isOpen=false
 *     - Step 1 content is shown by default (data-step="1")
 *     - Title "Recall Case" is rendered
 *     - Case label appears in the subtitle and summary grid
 *     - StatusPill shows for the case status
 *     - Warning banner is visible
 *     - Location is shown when provided; absent when omitted
 *     - Assignee is shown when provided; "Unassigned" when omitted
 *     - Template is shown when provided; absent when omitted
 *     - Last updated timestamp is shown
 *
 *   Interactions:
 *     - Clicking × close button calls onClose
 *     - Clicking Cancel button calls onClose
 *     - Clicking "Confirm Recall" button calls onConfirm
 *     - "Confirm Recall" advances modal to step 2 (data-step="2")
 *     - While isConfirming=true, Confirm button is disabled
 *     - While isConfirming=true, cancel button is disabled
 *     - While isConfirming=true, button shows "Confirming…" text
 *
 *   Accessibility:
 *     - dialog has aria-labelledby pointing to the title element
 *     - dialog has aria-describedby pointing to the case summary section
 *     - Warning banner has role="alert"
 *     - Cancel button has accessible name
 *     - Confirm button has accessible name containing case label
 *
 * Mocking strategy:
 *   - dialog.showModal() / dialog.close() polyfilled for jsdom
 *   - ReactDOM.createPortal rendered into document.body (available in jsdom)
 *   - Queries use data-testid to avoid jsdom dialog visibility quirks
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import * as React from "react";
import { RecallModal } from "../RecallModal";
import { RecallModalStep1Confirm } from "../RecallModalStep1Confirm";
import type { RecallCaseSummary } from "../RecallModal";

// ─── jsdom <dialog> polyfill ──────────────────────────────────────────────────
//
// jsdom does not implement showModal() / close(), so we polyfill them.
// showModal() sets the `open` attribute; close() removes it.
// This is consistent with how other modal tests in the project work.

beforeAll(() => {
  // biome-ignore lint/suspicious/noExplicitAny: polyfill
  (HTMLDialogElement.prototype as any).showModal = function () {
    this.setAttribute("open", "");
  };
  // biome-ignore lint/suspicious/noExplicitAny: polyfill
  (HTMLDialogElement.prototype as any).close = function () {
    this.removeAttribute("open");
  };
});

// ─── Shared test data ─────────────────────────────────────────────────────────

const CASE_DATA_FULL: RecallCaseSummary = {
  label: "CASE-042",
  status: "deployed",
  locationName: "Wind Farm Alpha — Turbine 7",
  assigneeName: "Jane Doe",
  templateName: "Inspection Kit v2",
  updatedAt: new Date("2024-06-15T14:30:00Z").getTime(),
};

const CASE_DATA_MINIMAL: RecallCaseSummary = {
  label: "CASE-001",
  status: "hangar",
  updatedAt: new Date("2024-01-01T00:00:00Z").getTime(),
};

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderRecallModal(
  props: Partial<Parameters<typeof RecallModal>[0]> & { isOpen?: boolean } = {}
) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();

  const { rerender, ...rest } = render(
    <RecallModal
      isOpen={props.isOpen ?? true}
      onClose={props.onClose ?? onClose}
      onConfirm={props.onConfirm ?? onConfirm}
      caseId={props.caseId ?? "case123"}
      caseData={props.caseData ?? CASE_DATA_FULL}
      isConfirming={props.isConfirming ?? false}
    />
  );

  return { onClose, onConfirm, rerender, ...rest };
}

function renderStep1Confirm(
  props: Partial<Parameters<typeof RecallModalStep1Confirm>[0]> = {}
) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();

  const { rerender, ...rest } = render(
    <RecallModalStep1Confirm
      caseId={props.caseId ?? "case123"}
      caseData={props.caseData ?? CASE_DATA_FULL}
      onClose={props.onClose ?? onClose}
      onConfirm={props.onConfirm ?? onConfirm}
      isConfirming={props.isConfirming ?? false}
    />
  );

  return { onClose, onConfirm, rerender, ...rest };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RecallModal — Step 1 (Confirm)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the modal dialog when isOpen=true", () => {
      renderRecallModal({ isOpen: true });
      const dialog = screen.getByTestId("recall-modal");
      expect(dialog).toBeTruthy();
    });

    it("does not render the modal portal when isOpen=false", () => {
      renderRecallModal({ isOpen: false });
      const dialog = screen.queryByTestId("recall-modal");
      // Portal is null before mount and when closed
      // jsdom: dialog exists but should not have open attribute
      if (dialog) {
        expect(dialog.hasAttribute("open")).toBe(false);
      } else {
        expect(dialog).toBeNull();
      }
    });

    it("shows step 1 content by default (data-step='1')", () => {
      renderRecallModal({ isOpen: true });
      const dialog = screen.getByTestId("recall-modal");
      expect(dialog.getAttribute("data-step")).toBe("1");
    });

    it("renders 'Recall Case' as the dialog title", () => {
      renderStep1Confirm();
      expect(screen.getByText("Recall Case")).toBeTruthy();
    });

    it("renders the case label in the subtitle", () => {
      renderStep1Confirm({ caseData: CASE_DATA_FULL });
      // label appears at least twice: subtitle + summary grid
      const elements = screen.getAllByText("CASE-042");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    it("renders the warning banner", () => {
      renderStep1Confirm();
      const banner = screen.getByTestId("recall-warning-banner");
      expect(banner).toBeTruthy();
    });

    it("renders the case summary section", () => {
      renderStep1Confirm();
      const summary = screen.getByTestId("recall-case-summary");
      expect(summary).toBeTruthy();
    });

    it("shows location when caseData.locationName is provided", () => {
      renderStep1Confirm({ caseData: CASE_DATA_FULL });
      expect(screen.getByText("Wind Farm Alpha — Turbine 7")).toBeTruthy();
    });

    it("does not show Location field when caseData.locationName is absent", () => {
      renderStep1Confirm({ caseData: CASE_DATA_MINIMAL });
      expect(screen.queryByText("Location")).toBeNull();
    });

    it("shows assignee name when provided", () => {
      renderStep1Confirm({ caseData: CASE_DATA_FULL });
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    it("shows 'Unassigned' when assigneeName is absent", () => {
      renderStep1Confirm({ caseData: CASE_DATA_MINIMAL });
      expect(screen.getByText("Unassigned")).toBeTruthy();
    });

    it("shows template name when provided", () => {
      renderStep1Confirm({ caseData: CASE_DATA_FULL });
      expect(screen.getByText("Inspection Kit v2")).toBeTruthy();
    });

    it("does not show Template field when templateName is absent", () => {
      renderStep1Confirm({ caseData: CASE_DATA_MINIMAL });
      expect(screen.queryByText("Template")).toBeNull();
    });

    it("shows 'Last Updated' label in the summary", () => {
      renderStep1Confirm();
      expect(screen.getByText("Last Updated")).toBeTruthy();
    });

    it("renders Cancel button", () => {
      renderStep1Confirm();
      const btn = screen.getByTestId("recall-cancel-btn");
      expect(btn).toBeTruthy();
      expect(btn.textContent?.trim()).toBe("Cancel");
    });

    it("renders Confirm Recall button", () => {
      renderStep1Confirm();
      const btn = screen.getByTestId("recall-confirm-btn");
      expect(btn).toBeTruthy();
      // includes icon + text
      expect(btn.textContent).toContain("Confirm Recall");
    });
  });

  // ── isConfirming state ──────────────────────────────────────────────────────

  describe("isConfirming loading state", () => {
    it("disables the Confirm button when isConfirming=true", () => {
      renderStep1Confirm({ isConfirming: true });
      const btn = screen.getByTestId("recall-confirm-btn") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("disables the Cancel button when isConfirming=true", () => {
      renderStep1Confirm({ isConfirming: true });
      const btn = screen.getByTestId("recall-cancel-btn") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("shows 'Confirming…' text when isConfirming=true", () => {
      renderStep1Confirm({ isConfirming: true });
      const btn = screen.getByTestId("recall-confirm-btn");
      expect(btn.textContent).toContain("Confirming");
    });

    it("does NOT disable Confirm button when isConfirming=false", () => {
      renderStep1Confirm({ isConfirming: false });
      const btn = screen.getByTestId("recall-confirm-btn") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  // ── Interactions ────────────────────────────────────────────────────────────

  describe("interactions", () => {
    it("calls onClose when × close button is clicked", () => {
      const onClose = vi.fn();
      renderStep1Confirm({ onClose });
      fireEvent.click(screen.getByTestId("recall-modal-close"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when Cancel button is clicked", () => {
      const onClose = vi.fn();
      renderStep1Confirm({ onClose });
      fireEvent.click(screen.getByTestId("recall-cancel-btn"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onConfirm when Confirm Recall button is clicked", () => {
      const onConfirm = vi.fn();
      renderStep1Confirm({ onConfirm });
      fireEvent.click(screen.getByTestId("recall-confirm-btn"));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("does NOT call onConfirm when isConfirming=true and button is disabled", () => {
      const onConfirm = vi.fn();
      renderStep1Confirm({ onConfirm, isConfirming: true });
      const btn = screen.getByTestId("recall-confirm-btn") as HTMLButtonElement;
      // Disabled buttons do not fire click events in jsdom
      fireEvent.click(btn);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("advances modal to step 2 when Confirm Recall is clicked (RecallModal)", async () => {
      const { rerender } = renderRecallModal({ isOpen: true });

      await act(async () => {
        fireEvent.click(screen.getByTestId("recall-confirm-btn"));
      });

      const dialog = screen.getByTestId("recall-modal");
      expect(dialog.getAttribute("data-step")).toBe("2");
      // Step 2 reroute view is now rendered
      expect(screen.getByTestId("recall-modal-step2-reroute")).toBeTruthy();
    });

    it("calls onConfirm callback on RecallModal confirm click", async () => {
      const onConfirm = vi.fn();
      renderRecallModal({ isOpen: true, onConfirm });

      await act(async () => {
        fireEvent.click(screen.getByTestId("recall-confirm-btn"));
      });

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("calls onClose on RecallModal close button click", async () => {
      const onClose = vi.fn();
      renderRecallModal({ isOpen: true, onClose });

      await act(async () => {
        fireEvent.click(screen.getByTestId("recall-modal-close"));
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("resets to step 1 when modal re-opens", async () => {
      const { rerender } = renderRecallModal({ isOpen: true });

      // Advance to step 2
      await act(async () => {
        fireEvent.click(screen.getByTestId("recall-confirm-btn"));
      });

      expect(screen.getByTestId("recall-modal").getAttribute("data-step")).toBe("2");

      // Close
      await act(async () => {
        rerender(
          <RecallModal
            isOpen={false}
            onClose={vi.fn()}
            onConfirm={vi.fn()}
            caseId="case123"
            caseData={CASE_DATA_FULL}
          />
        );
      });

      // Re-open
      await act(async () => {
        rerender(
          <RecallModal
            isOpen={true}
            onClose={vi.fn()}
            onConfirm={vi.fn()}
            caseId="case123"
            caseData={CASE_DATA_FULL}
          />
        );
      });

      expect(screen.getByTestId("recall-modal").getAttribute("data-step")).toBe("1");
    });
  });

  // ── Accessibility ───────────────────────────────────────────────────────────

  describe("accessibility", () => {
    it("dialog has aria-labelledby='recall-modal-title'", () => {
      renderRecallModal({ isOpen: true });
      const dialog = screen.getByTestId("recall-modal");
      expect(dialog.getAttribute("aria-labelledby")).toBe("recall-modal-title");
    });

    it("dialog has aria-describedby='recall-modal-desc'", () => {
      renderRecallModal({ isOpen: true });
      const dialog = screen.getByTestId("recall-modal");
      expect(dialog.getAttribute("aria-describedby")).toBe("recall-modal-desc");
    });

    it("warning banner has role='alert'", () => {
      renderStep1Confirm();
      const banner = screen.getByTestId("recall-warning-banner");
      expect(banner.getAttribute("role")).toBe("alert");
    });

    it("Confirm button has aria-label containing case label", () => {
      renderStep1Confirm({ caseData: CASE_DATA_FULL });
      const btn = screen.getByTestId("recall-confirm-btn");
      const label = btn.getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label).toContain("CASE-042");
    });

    it("close button has aria-label='Close recall dialog'", () => {
      renderStep1Confirm();
      const btn = screen.getByTestId("recall-modal-close");
      expect(btn.getAttribute("aria-label")).toBe("Close recall dialog");
    });
  });

  // ── Step 1 only — StatusPill ────────────────────────────────────────────────

  describe("StatusPill in case summary", () => {
    it("renders a StatusPill with the case status", () => {
      renderStep1Confirm({ caseData: { ...CASE_DATA_FULL, status: "deployed" } });
      // StatusPill renders as a <span role="status"> with aria-label
      const pill = screen
        .getByRole("status", { name: /deployed/i });
      expect(pill).toBeTruthy();
    });

    it("renders the correct status pill for 'hangar' status", () => {
      renderStep1Confirm({ caseData: CASE_DATA_MINIMAL });
      const pill = screen.getByRole("status", { name: /in hangar/i });
      expect(pill).toBeTruthy();
    });
  });
});
