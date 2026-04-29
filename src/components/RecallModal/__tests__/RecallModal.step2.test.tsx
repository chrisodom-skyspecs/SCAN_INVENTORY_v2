/**
 * RecallModal Step 2 (Reroute) — unit tests.
 *
 * Tests:
 *   Rendering:
 *     - Step 2 content is shown when data-step="2"
 *     - Title "Recall — Reroute" is rendered
 *     - Case label appears in the subtitle
 *     - Step badge "2 / 2" is rendered
 *     - All three return-method radio cards are rendered
 *     - FedEx option is selected by default
 *     - Notes textarea is rendered
 *     - Back button is rendered
 *     - Submit Recall button is rendered
 *
 *   Return method selection:
 *     - Clicking "Driver Pickup" card selects it (data-selected="true")
 *     - Clicking "Warehouse Drop-off" card selects it
 *     - Clicking "FedEx" after another method re-selects FedEx
 *     - Only one method is selected at a time
 *
 *   Notes field:
 *     - Typing in notes textarea updates the value
 *     - Character count appears when notes > 900 chars
 *     - Character count is hidden when notes ≤ 900 chars
 *
 *   Submit:
 *     - Clicking Submit calls onSubmit with selected method and empty notes
 *     - Clicking Submit calls onSubmit with notes when notes are entered
 *     - notes is undefined in payload when textarea is only whitespace
 *     - onSubmit is NOT called when isSubmitting=true
 *     - Submit button shows "Submitting…" when isSubmitting=true
 *     - Submit button is disabled when isSubmitting=true
 *     - Back button is disabled when isSubmitting=true
 *
 *   Back / close:
 *     - Clicking Back calls onBack
 *     - Clicking × close button calls onClose
 *     - In RecallModal: clicking Back returns to step 1 (data-step="1")
 *
 *   Accessibility:
 *     - Return method fieldset has a legend "Return Method"
 *     - Radio inputs are keyboard-accessible
 *     - Submit button has aria-label containing the case label
 *     - × close button has aria-label="Close recall dialog"
 *     - Notes textarea has an accessible label
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import * as React from "react";
import { RecallModal } from "../RecallModal";
import { RecallModalStep2Reroute } from "../RecallModalStep2Reroute";
import type { RecallCaseSummary, RecallRerouteData } from "../index";

// ─── jsdom <dialog> polyfill ──────────────────────────────────────────────────

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

const CASE_DATA: RecallCaseSummary = {
  label: "CASE-099",
  status: "deployed",
  locationName: "Wind Farm Beta — Turbine 12",
  assigneeName: "Alex Smith",
  templateName: "Inspection Kit v3",
  updatedAt: new Date("2024-08-20T09:15:00Z").getTime(),
};

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderStep2(
  props: Partial<React.ComponentProps<typeof RecallModalStep2Reroute>> = {}
) {
  const onClose = vi.fn();
  const onBack = vi.fn();
  const onSubmit = vi.fn();

  render(
    <RecallModalStep2Reroute
      caseId={props.caseId ?? "case-abc"}
      caseData={props.caseData ?? CASE_DATA}
      onClose={props.onClose ?? onClose}
      onBack={props.onBack ?? onBack}
      onSubmit={props.onSubmit ?? onSubmit}
      isSubmitting={props.isSubmitting ?? false}
    />
  );

  return { onClose, onBack, onSubmit };
}

function renderRecallModalAtStep2(
  extraProps: Partial<React.ComponentProps<typeof RecallModal>> = {}
) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const onSubmit = vi.fn();

  const utils = render(
    <RecallModal
      isOpen={true}
      onClose={onClose}
      onConfirm={onConfirm}
      onSubmit={onSubmit}
      caseId="case-abc"
      caseData={CASE_DATA}
      step={2}
      {...extraProps}
    />
  );

  return { onClose, onConfirm, onSubmit, ...utils };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RecallModalStep2Reroute — Step 2 (Reroute)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the step 2 reroute container", () => {
      renderStep2();
      expect(screen.getByTestId("recall-modal-step2-reroute")).toBeTruthy();
    });

    it("renders 'Recall — Reroute' as the title", () => {
      renderStep2();
      expect(screen.getByText("Recall — Reroute")).toBeTruthy();
    });

    it("renders the case label in the subtitle row", () => {
      renderStep2({ caseData: CASE_DATA });
      expect(screen.getByText("CASE-099")).toBeTruthy();
    });

    it("renders a step badge with '2 / 2'", () => {
      renderStep2();
      expect(screen.getByText("2 / 2")).toBeTruthy();
    });

    it("renders the Return Method fieldset with legend", () => {
      renderStep2();
      expect(screen.getByText("Return Method")).toBeTruthy();
    });

    it("renders all three return-method radio cards", () => {
      renderStep2();
      expect(screen.getByTestId("recall-method-option-fedex")).toBeTruthy();
      expect(screen.getByTestId("recall-method-option-driver_pickup")).toBeTruthy();
      expect(screen.getByTestId("recall-method-option-warehouse_drop_off")).toBeTruthy();
    });

    it("renders method labels", () => {
      renderStep2();
      expect(screen.getByText("FedEx")).toBeTruthy();
      expect(screen.getByText("Driver Pickup")).toBeTruthy();
      expect(screen.getByText("Warehouse Drop-off")).toBeTruthy();
    });

    it("renders method descriptions", () => {
      renderStep2();
      expect(
        screen.getByText(/Ship via FedEx carrier pick-up/i)
      ).toBeTruthy();
      expect(
        screen.getByText(/Dispatch a driver to collect/i)
      ).toBeTruthy();
      expect(
        screen.getByText(/delivers the case directly to the warehouse/i)
      ).toBeTruthy();
    });

    it("renders the notes textarea", () => {
      renderStep2();
      expect(screen.getByTestId("recall-notes-textarea")).toBeTruthy();
    });

    it("renders the Back button", () => {
      renderStep2();
      const btn = screen.getByTestId("recall-back-btn");
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain("Back");
    });

    it("renders the Submit Recall button", () => {
      renderStep2();
      const btn = screen.getByTestId("recall-submit-btn");
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain("Submit Recall");
    });

    it("× close button is rendered", () => {
      renderStep2();
      expect(screen.getByTestId("recall-step2-close")).toBeTruthy();
    });
  });

  // ── Default selected state ──────────────────────────────────────────────────

  describe("default state", () => {
    it("FedEx radio is selected by default", () => {
      renderStep2();
      const fedexRadio = screen.getByTestId(
        "recall-method-radio-fedex"
      ) as HTMLInputElement;
      expect(fedexRadio.checked).toBe(true);
    });

    it("FedEx card has data-selected='true' by default", () => {
      renderStep2();
      const card = screen.getByTestId("recall-method-option-fedex");
      expect(card.getAttribute("data-selected")).toBe("true");
    });

    it("Driver Pickup card has data-selected='false' by default", () => {
      renderStep2();
      const card = screen.getByTestId("recall-method-option-driver_pickup");
      expect(card.getAttribute("data-selected")).toBe("false");
    });

    it("Warehouse Drop-off card has data-selected='false' by default", () => {
      renderStep2();
      const card = screen.getByTestId("recall-method-option-warehouse_drop_off");
      expect(card.getAttribute("data-selected")).toBe("false");
    });

    it("notes textarea is empty by default", () => {
      renderStep2();
      const textarea = screen.getByTestId(
        "recall-notes-textarea"
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe("");
    });
  });

  // ── Return method selection ─────────────────────────────────────────────────

  describe("return method selection", () => {
    it("clicking Driver Pickup radio selects it", () => {
      renderStep2();
      const radio = screen.getByTestId(
        "recall-method-radio-driver_pickup"
      ) as HTMLInputElement;
      fireEvent.click(radio);
      expect(radio.checked).toBe(true);
    });

    it("clicking Driver Pickup card sets data-selected='true'", () => {
      renderStep2();
      fireEvent.click(
        screen.getByTestId("recall-method-radio-driver_pickup")
      );
      expect(
        screen
          .getByTestId("recall-method-option-driver_pickup")
          .getAttribute("data-selected")
      ).toBe("true");
    });

    it("clicking Warehouse Drop-off radio selects it", () => {
      renderStep2();
      const radio = screen.getByTestId(
        "recall-method-radio-warehouse_drop_off"
      ) as HTMLInputElement;
      fireEvent.click(radio);
      expect(radio.checked).toBe(true);
    });

    it("selecting Driver Pickup deselects FedEx", () => {
      renderStep2();
      fireEvent.click(
        screen.getByTestId("recall-method-radio-driver_pickup")
      );
      const fedexRadio = screen.getByTestId(
        "recall-method-radio-fedex"
      ) as HTMLInputElement;
      expect(fedexRadio.checked).toBe(false);
    });

    it("re-clicking FedEx after another selection re-selects FedEx", () => {
      renderStep2();
      fireEvent.click(
        screen.getByTestId("recall-method-radio-driver_pickup")
      );
      fireEvent.click(screen.getByTestId("recall-method-radio-fedex"));
      const fedexRadio = screen.getByTestId(
        "recall-method-radio-fedex"
      ) as HTMLInputElement;
      expect(fedexRadio.checked).toBe(true);
    });

    it("only one method card has data-selected='true' at a time", () => {
      renderStep2();
      fireEvent.click(
        screen.getByTestId("recall-method-radio-warehouse_drop_off")
      );

      const methods = ["fedex", "driver_pickup", "warehouse_drop_off"] as const;
      const selectedCards = methods.filter(
        (v) =>
          screen
            .getByTestId(`recall-method-option-${v}`)
            .getAttribute("data-selected") === "true"
      );
      expect(selectedCards).toHaveLength(1);
      expect(selectedCards[0]).toBe("warehouse_drop_off");
    });
  });

  // ── Notes field ─────────────────────────────────────────────────────────────

  describe("notes field", () => {
    it("typing in notes textarea updates the value", () => {
      renderStep2();
      const textarea = screen.getByTestId(
        "recall-notes-textarea"
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "Test note" } });
      expect(textarea.value).toBe("Test note");
    });

    it("character count is NOT shown when notes length ≤ 900", () => {
      renderStep2();
      const textarea = screen.getByTestId("recall-notes-textarea");
      fireEvent.change(textarea, { target: { value: "Short note" } });
      expect(screen.queryByTestId("recall-notes-count")).toBeNull();
    });

    it("character count IS shown when notes length > 900", () => {
      renderStep2();
      const textarea = screen.getByTestId("recall-notes-textarea");
      const longNote = "a".repeat(901);
      fireEvent.change(textarea, { target: { value: longNote } });
      expect(screen.getByTestId("recall-notes-count")).toBeTruthy();
    });

    it("character count shows correct count when near limit", () => {
      renderStep2();
      const textarea = screen.getByTestId("recall-notes-textarea");
      const note = "b".repeat(950);
      fireEvent.change(textarea, { target: { value: note } });
      expect(screen.getByTestId("recall-notes-count").textContent).toContain(
        "950"
      );
    });
  });

  // ── Submit behaviour ────────────────────────────────────────────────────────

  describe("submit", () => {
    it("calls onSubmit with default fedex method and no notes on Submit click", () => {
      const onSubmit = vi.fn();
      renderStep2({ onSubmit });
      fireEvent.click(screen.getByTestId("recall-submit-btn"));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining<Partial<RecallRerouteData>>({
          returnMethod: "fedex",
        })
      );
      expect(onSubmit.mock.calls[0][0].notes).toBeUndefined();
    });

    it("calls onSubmit with driver_pickup when that method is selected", () => {
      const onSubmit = vi.fn();
      renderStep2({ onSubmit });
      fireEvent.click(
        screen.getByTestId("recall-method-radio-driver_pickup")
      );
      fireEvent.click(screen.getByTestId("recall-submit-btn"));
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining<Partial<RecallRerouteData>>({
          returnMethod: "driver_pickup",
        })
      );
    });

    it("calls onSubmit with warehouse_drop_off when that method is selected", () => {
      const onSubmit = vi.fn();
      renderStep2({ onSubmit });
      fireEvent.click(
        screen.getByTestId("recall-method-radio-warehouse_drop_off")
      );
      fireEvent.click(screen.getByTestId("recall-submit-btn"));
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining<Partial<RecallRerouteData>>({
          returnMethod: "warehouse_drop_off",
        })
      );
    });

    it("passes notes string when notes are entered", () => {
      const onSubmit = vi.fn();
      renderStep2({ onSubmit });
      fireEvent.change(screen.getByTestId("recall-notes-textarea"), {
        target: { value: "Return via morning route." },
      });
      fireEvent.click(screen.getByTestId("recall-submit-btn"));
      expect(onSubmit.mock.calls[0][0].notes).toBe(
        "Return via morning route."
      );
    });

    it("notes is undefined in payload when textarea is only whitespace", () => {
      const onSubmit = vi.fn();
      renderStep2({ onSubmit });
      fireEvent.change(screen.getByTestId("recall-notes-textarea"), {
        target: { value: "   " },
      });
      fireEvent.click(screen.getByTestId("recall-submit-btn"));
      expect(onSubmit.mock.calls[0][0].notes).toBeUndefined();
    });

    it("does NOT call onSubmit when isSubmitting=true and button is disabled", () => {
      const onSubmit = vi.fn();
      renderStep2({ onSubmit, isSubmitting: true });
      const btn = screen.getByTestId(
        "recall-submit-btn"
      ) as HTMLButtonElement;
      fireEvent.click(btn);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("Submit button is disabled when isSubmitting=true", () => {
      renderStep2({ isSubmitting: true });
      const btn = screen.getByTestId(
        "recall-submit-btn"
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("Submit button shows 'Submitting…' text when isSubmitting=true", () => {
      renderStep2({ isSubmitting: true });
      const btn = screen.getByTestId("recall-submit-btn");
      expect(btn.textContent).toContain("Submitting");
    });

    it("Submit button shows 'Submit Recall' text when isSubmitting=false", () => {
      renderStep2({ isSubmitting: false });
      const btn = screen.getByTestId("recall-submit-btn");
      expect(btn.textContent).toContain("Submit Recall");
    });
  });

  // ── Back / close ────────────────────────────────────────────────────────────

  describe("back and close", () => {
    it("calls onBack when Back button is clicked", () => {
      const onBack = vi.fn();
      renderStep2({ onBack });
      fireEvent.click(screen.getByTestId("recall-back-btn"));
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("Back button is disabled when isSubmitting=true", () => {
      renderStep2({ isSubmitting: true });
      const btn = screen.getByTestId("recall-back-btn") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("calls onClose when × close button is clicked", () => {
      const onClose = vi.fn();
      renderStep2({ onClose });
      fireEvent.click(screen.getByTestId("recall-step2-close"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("× close button is disabled when isSubmitting=true", () => {
      renderStep2({ isSubmitting: true });
      const btn = screen.getByTestId(
        "recall-step2-close"
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("in RecallModal: clicking Back in step 2 returns to step 1", async () => {
      // Use uncontrolled step (no `step` prop) so internal step state is mutable.
      render(
        <RecallModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          caseId="case-abc"
          caseData={CASE_DATA}
          // no `step` prop — uncontrolled mode
        />
      );

      // Advance to step 2 by clicking Confirm Recall in step 1.
      await act(async () => {
        fireEvent.click(screen.getByTestId("recall-confirm-btn"));
      });

      expect(screen.getByTestId("recall-modal").getAttribute("data-step")).toBe("2");

      // Click Back to return to step 1.
      await act(async () => {
        fireEvent.click(screen.getByTestId("recall-back-btn"));
      });

      expect(screen.getByTestId("recall-modal").getAttribute("data-step")).toBe("1");
    });
  });

  // ── Full RecallModal integration ─────────────────────────────────────────────

  describe("RecallModal integration — step 2", () => {
    it("shows step 2 reroute when step prop is 2", () => {
      renderRecallModalAtStep2();
      expect(screen.getByTestId("recall-modal").getAttribute("data-step")).toBe("2");
      expect(screen.getByTestId("recall-modal-step2-reroute")).toBeTruthy();
    });

    it("calls onSubmit on RecallModal when step 2 is submitted", async () => {
      const { onSubmit } = renderRecallModalAtStep2();

      await act(async () => {
        fireEvent.click(
          screen.getByTestId("recall-method-radio-driver_pickup")
        );
        fireEvent.click(screen.getByTestId("recall-submit-btn"));
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining<Partial<RecallRerouteData>>({
          returnMethod: "driver_pickup",
        })
      );
    });

    it("RecallModal disables Submit and Back when isSubmitting=true", () => {
      renderRecallModalAtStep2({ isSubmitting: true });
      expect(
        (screen.getByTestId("recall-submit-btn") as HTMLButtonElement).disabled
      ).toBe(true);
      expect(
        (screen.getByTestId("recall-back-btn") as HTMLButtonElement).disabled
      ).toBe(true);
    });

    it("screen-reader step announcement shows 'Step 2 of 2'", () => {
      renderRecallModalAtStep2();
      expect(screen.getByText("Step 2 of 2")).toBeTruthy();
    });
  });

  // ── Accessibility ───────────────────────────────────────────────────────────

  describe("accessibility", () => {
    it("Submit button has aria-label containing case label", () => {
      renderStep2({ caseData: CASE_DATA });
      const btn = screen.getByTestId("recall-submit-btn");
      const label = btn.getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label).toContain("CASE-099");
    });

    it("× close button has aria-label='Close recall dialog'", () => {
      renderStep2();
      const btn = screen.getByTestId("recall-step2-close");
      expect(btn.getAttribute("aria-label")).toBe("Close recall dialog");
    });

    it("Back button has aria-label='Back to step 1'", () => {
      renderStep2();
      const btn = screen.getByTestId("recall-back-btn");
      expect(btn.getAttribute("aria-label")).toBe("Back to step 1");
    });

    it("radio inputs have type='radio'", () => {
      renderStep2();
      const fedexRadio = screen.getByTestId(
        "recall-method-radio-fedex"
      ) as HTMLInputElement;
      expect(fedexRadio.type).toBe("radio");
    });

    it("all radios share the same name (radio group)", () => {
      renderStep2({ caseId: "test-case" });
      const radios = [
        screen.getByTestId("recall-method-radio-fedex"),
        screen.getByTestId("recall-method-radio-driver_pickup"),
        screen.getByTestId("recall-method-radio-warehouse_drop_off"),
      ] as HTMLInputElement[];
      const names = radios.map((r) => r.name);
      expect(new Set(names).size).toBe(1);
    });

    it("notes textarea has an associated label", () => {
      renderStep2({ caseId: "test-case" });
      const textarea = screen.getByTestId(
        "recall-notes-textarea"
      ) as HTMLTextAreaElement;
      // label must be associated via htmlFor/id
      expect(textarea.id).toBeTruthy();
      const label = document.querySelector(`label[for="${textarea.id}"]`);
      expect(label).toBeTruthy();
    });

    it("Submit button aria-label changes to 'Submitting recall…' when isSubmitting", () => {
      renderStep2({ isSubmitting: true });
      const btn = screen.getByTestId("recall-submit-btn");
      expect(btn.getAttribute("aria-label")).toBe("Submitting recall…");
    });
  });
});
